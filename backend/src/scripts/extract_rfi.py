import sys
import json
import re
import fitz  # type: ignore

def extract_sk_number(original_filename):
    """
    Extract SK# exclusively from the PDF filename/title.
    Matches patterns like: SK1, SK-01, SK_02, SK#3, SK 04
    Normalizes to: SK#1, SK#2, SK#3 (no leading zeros).
    Returns 'SK# - Unknown' if no match is found.
    """
    # Pattern: SK optionally followed by separator (#/-/_/space) then digits
    sk_pattern = re.compile(r'SK[\s#\-_]*(\d+)', re.IGNORECASE)
    m = sk_pattern.search(original_filename)
    if m:
        num = int(m.group(1))  # strip leading zeros by converting to int
        return f"SK#{num}"
    return 'SK# - Unknown'

def extract_rfi(pdf_path, original_filename):
    rfis = []
    
    try:
        doc = fitz.open(pdf_path)

        # Extract SK# from the filename only
        sk_number = extract_sk_number(original_filename)
        
        for page in doc:
            valid_annots = []
            
            # 1. Grab PDF Annotations (comments, text boxes, markups)
            page_annots = page.annots() # type: ignore
            if page_annots:
                for annot in page_annots:
                    info = annot.info
                    content = info.get('content', '')
                    # Base annotation text
                    if content and content.strip():
                        valid_annots.append({
                            'text': content.strip(),
                            'x0': annot.rect.x0,
                            'y0': annot.rect.y0,
                            'x1': annot.rect.x1,
                            'y1': annot.rect.y1,
                            'rect': annot.rect
                        })
                    # Check annotation colors for blue (r,g low, b high)
                    try:
                        colors = annot.colors or {}
                        for col in colors.values():
                            if isinstance(col, (list, tuple)) and len(col) == 3:
                                r, g, b = col
                                if r < 0.1 and g < 0.1 and b > 0.5:
                                    txt = content.strip() if content else ''
                                    if txt:
                                        valid_annots.append({
                                            'text': txt,
                                            'x0': annot.rect.x0,
                                            'y0': annot.rect.y0,
                                            'x1': annot.rect.x1,
                                            'y1': annot.rect.y1,
                                            'rect': annot.rect
                                        })
                    except Exception:
                        pass
                    
            try:
                text_dict = page.get_text("dict")
                for block in text_dict.get('blocks', []):
                    for line in block.get('lines', []):
                        for span in line.get('spans', []):
                            color = span.get('color')
                            if isinstance(color, (list, tuple)) and len(color) == 3:
                                r, g, b = color
                                if r < 0.1 and g < 0.1 and b > 0.5:
                                    txt = span.get('text', '').strip()
                                    # Only consider blue text that looks like a Q marker (e.g., Q1, Q2.)
                                    if txt and re.search(r"\bQ\d+\b", txt, re.IGNORECASE):
                                        x0, y0, x1, y1 = span.get('bbox', [0, 0, 0, 0])
                                        valid_annots.append({
                                            'text': txt,
                                            'x0': x0,
                                            'y0': y0,
                                            'x1': x1,
                                            'y1': y1,
                                            'rect': fitz.Rect(x0, y0, x1, y1)
                                        })
            except Exception as e:
                print(f"[RfiScript] Warning: Failed to extract blue text spans: {e}")        
            # Remove duplicated annotation boxes placed exactly on top of each other
            unique_annots = []
            for a in valid_annots:
                if not any(ua['text'] == a['text'] and abs(ua['x0']-a['x0']) < 5 and abs(ua['y0']-a['y0']) < 5 for ua in unique_annots):
                    unique_annots.append(a)
            valid_annots = unique_annots

            # 2. Pair Q markers with their description boxes
            page_rfis = []
            
            for a in valid_annots:
                text = a['text']
                
                # Check if it's a STANDALONE Q marker (e.g. exactly "Q1" or "Q1.")
                standalone_match = re.match(r'^[*\-\s]*Q\s*(\d+)[\.:\-]?[\s]*$', text, re.IGNORECASE)
                if standalone_match:
                    rfi_num = f"Q{standalone_match.group(1)}"
                    
                    # Find the nearest separate text box to be the description
                    best_annot = {}
                    min_dist = float('inf')
                    
                    for sibling in valid_annots:
                        if sibling == a: continue
                        if re.match(r'^Q\d+[\.\-\:]?$', sibling['text'], re.IGNORECASE): continue
                        
                        # Calculate minimum distance between bounding boxes (0 if overlapping)
                        x_dist = max(0, max(a['x0'] - sibling['x1'], sibling['x0'] - a['x1']))
                        y_dist = max(0, max(a['y0'] - sibling['y1'], sibling['y0'] - a['y1']))
                        rect_dist = (x_dist**2 + y_dist**2)**0.5
                        
                        # Tiebreaker: distance between centers
                        cx_a, cy_a = (a['x0'] + a['x1'])/2, (a['y0'] + a['y1'])/2
                        cx_s, cy_s = (sibling['x0'] + sibling['x1'])/2, (sibling['y0'] + sibling['y1'])/2
                        center_dist = ((cx_a - cx_s)**2 + (cy_a - cy_s)**2)**0.5
                        
                        # If boxes overlap or are very close, favor the one with more text
                        overlap_bonus = len(sibling['text']) * 0.5 if rect_dist < 20 else 0
                        
                        dist = rect_dist + 0.01 * center_dist - overlap_bonus
                        
                        # Constraints: must be reasonably close, and ideally has some text mass (not just "PAGE 01")
                        if dist < min_dist and dist < 2000:
                            if len(sibling['text']) > 5 or 'response' in sibling['text'].lower():
                                min_dist = dist
                                best_annot = sibling
                                
                    desc = str(best_annot.get('text', ''))
                    page_rfis.append({
                        'rfiNumber': rfi_num,
                        'refDrawing': original_filename,
                        'description': desc,
                        'response': '',
                        'status': 'OPEN',
                        'remarks': '',
                        'skNumber': sk_number,
                        '_rect': best_annot.get('rect', a['rect'])
                    })
                    continue

                # Check if it's a COMBINED Q marker (e.g., "Q1 The architectural drawing...")
                combined_match = re.match(r'^Q(\d+)[\.\-\:\s]+(.+)', text, re.IGNORECASE | re.DOTALL)
                if combined_match:
                    rfi_num = f"Q{combined_match.group(1)}"
                    desc = combined_match.group(2).strip()
                    page_rfis.append({
                        'rfiNumber': rfi_num,
                        'refDrawing': original_filename,
                        'description': desc,
                        'response': '',
                        'status': 'OPEN',
                        'remarks': '',
                        'skNumber': sk_number,
                        '_rect': a['rect']
                    })

            # Additional fallback: scan raw page text for Q markers when still none found
            if not page_rfis:
                raw_text = page.get_text("text")
                for line in raw_text.splitlines():
                    line = line.strip()
                    if not line:
                        continue
                    # Look for patterns like 'Q1', 'Q2.', possibly with preceding symbols
                    m = re.search(r'\bQ\s*\d+\b', line, re.IGNORECASE)
                    if m:
                        rfi_num = re.sub(r'\s+', '', m.group(0)).upper()
                        desc = line.replace(m.group(0), '').strip(' :.-')
                        page_rfis.append({
                            'rfiNumber': rfi_num,
                            'refDrawing': original_filename,
                            'description': desc,
                            'response': '',
                            'status': 'OPEN',
                            'remarks': '',
                            'skNumber': sk_number,
                            '_rect': None
                        })

            if not page_rfis:
                # Scan all valid_annots for any text containing a Q marker pattern
                for a2 in valid_annots:
                    txt = a2['text']
                    fallback_match = re.search(r'\bQ\s*\d+\b', txt, re.IGNORECASE)
                    if fallback_match:
                        # Use the whole annotation text as description if it contains extra info
                        desc_text = txt.replace(fallback_match.group(0), '').strip(' :.-')
                        rfi_num = re.sub(r'\s+', '', fallback_match.group(0)).upper()
                        page_rfis.append({
                            'rfiNumber': rfi_num,
                            'refDrawing': original_filename,
                            'description': desc_text,
                            'response': '',
                            'status': 'OPEN',
                            'remarks': '',
                            'skNumber': sk_number,
                            '_rect': a2['rect']
                        })
            # End of fallback handling

            # 3. Process Responses and Status Keywords (e.g. finding standalone "Confirmed" boxes nearby)
            closed_keywords = ['confirmed', 'ok', 'approved', 'closed', 'resolved']
            
            for rfi in page_rfis:
                # Embedded inline response (e.g., "Response: Confirmed" inside the main description box)
                desc_text = str(rfi.get('description', ''))
                resp_match = re.search(r'\b(response|ans|answer)\s*:', desc_text, re.IGNORECASE)
                if resp_match:
                    start_idx = int(resp_match.start())
                    end_idx = int(resp_match.end())
                    rfi['response'] = desc_text[end_idx:].strip()  # type: ignore
                    rfi['description'] = desc_text[:start_idx].strip()  # type: ignore
                    
                # Search nearby valid annots that might act as response labels
                desc_rect = rfi['_rect']
                drect = fitz.Rect(desc_rect)
                expanded_drect = drect + (-50, -50, 50, 50) # Expand boundary by 50 points to catch overlapping/adjacent boxes
                
                for a in valid_annots:
                    # skip if it's the exact same text as the description or RFI num
                    if a['text'] == rfi['description'] or a['text'] == rfi['rfiNumber']: continue
                    
                    irect = fitz.Rect(a['rect'])
                    if expanded_drect.intersects(irect):
                        text_lower = a['text'].lower()
                        words = set(re.findall(r'\b\w+\b', text_lower))
                        
                        # Catch standalone status words
                        if any(k in words for k in closed_keywords):
                            rfi['status'] = 'CLOSED'
                            if not rfi['response'] and 'confirmed' in words: rfi['response'] = 'Confirmed'
                            if not rfi['response'] and 'approved' in words: rfi['response'] = 'Approved'
                            if not rfi['response'] and 'ok' in words: rfi['response'] = 'OK'
                            
                        # Catch explicit response boxes
                        if text_lower.startswith('response:') or text_lower.startswith('ans:'):
                            parts = re.split(r'response:|ans:|answer:', a['text'], flags=re.IGNORECASE)
                            if len(parts) > 1:
                                rfi['response'] = parts[-1].strip()
                                
                rfis.append(rfi)

        doc.close()

        # 4. Cleanup and Deduplicate across the whole document
        unique_rfis = {}
        for r in rfis:
            r.pop('_rect', None) # Remove internal tracking rect
            rfi_num = r['rfiNumber']
            
            # If Q1 is found multiple times, prefer the one with the longest description text
            if rfi_num not in unique_rfis:
                unique_rfis[rfi_num] = r
            else:
                if len(r['description']) > len(unique_rfis[rfi_num]['description']):
                    unique_rfis[rfi_num] = r
                    
        final_rfis = list(unique_rfis.values())
        print(json.dumps({"success": True, "rfis": final_rfis}))

    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))

if __name__ == "__main__":
    if len(sys.argv) < 3:
        pass
    else:
        extract_rfi(sys.argv[1], sys.argv[2])
