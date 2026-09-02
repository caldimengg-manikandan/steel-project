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
    sk_pattern = re.compile(r'SK[\s#\-_]*(\d+)', re.IGNORECASE)
    m = sk_pattern.search(original_filename)
    if m:
        num = int(m.group(1))  # strip leading zeros by converting to int
        return f"SK#{num}"
    return 'SK# - Unknown'


def get_q_num(text):
    """Extract the first Q-number found in a text string, e.g. 'Q1' -> '1'."""
    m = re.search(r'\bQ\s*(\d+)\b', text, re.IGNORECASE)
    return m.group(1) if m else None


def is_drawing_note(text):
    """Detect if a text block is likely a drawing legend or general notes block rather than an RFI description."""
    text_upper = text.upper()
    
    # 1. Explicit Headers
    if any(h in text_upper for h in ["GENERAL NOTES", "STRUCTURAL NOTES", "TYPICAL NOTES"]):
        return True
        
    # 2. Legends (Denotes/Indicates)
    if text_upper.count("DENOTES") + text_upper.count("INDICATES") >= 2:
        return True
        
    # 3. Heavy CAD Abbreviations
    if text_upper.count("U.N.O") >= 2 or text_upper.count("UNO") >= 3:
        return True
        
    # 4. Long Numbered Lists (4+ items) - RFIs rarely have 4+ numbered items in a single bubble
    list_matches = re.findall(r'\b\d+\s*\.\s*[A-Z\-]', text_upper)
    if len(list_matches) >= 4:
        return True
        
    # 5. Title block elements
    if "DRAWING TITLE" in text_upper or "SHEET TITLE" in text_upper:
        return True
        
    return False


def is_blue_color(color):
    """Check if RGB color tuple or stroke is pure blue (not cyan, yellow, or green)."""
    if not color or not isinstance(color, (list, tuple)) or len(color) < 3:
        return False
    r, g, b = float(color[0]), float(color[1]), float(color[2])
    if r > 1 or g > 1 or b > 1:
        r, g, b = r / 255.0, g / 255.0, b / 255.0
    return b > 0.4 and r < 0.3 and (b > g + 0.2)


def get_blue_boxes(page):
    """Find blue annotation or vector drawing rectangles on the page."""
    blue_rects = []
    try:
        annots = page.annots()
        if annots:
            for a in annots:
                colors = getattr(a, 'colors', {})
                stroke = colors.get("stroke") if isinstance(colors, dict) else None
                fill = colors.get("fill") if isinstance(colors, dict) else None
                if is_blue_color(stroke) or is_blue_color(fill):
                    blue_rects.append(a.rect)
    except Exception:
        pass

    try:
        drawings = page.get_drawings()
        for d in drawings:
            col = d.get("color")
            fill = d.get("fill")
            if is_blue_color(col) or is_blue_color(fill):
                r = d.get("rect")
                if r and (r.x1 - r.x0) > 20 and (r.y1 - r.y0) > 10:
                    blue_rects.append(r)
    except Exception:
        pass

    return blue_rects


def extract_rfi(pdf_path, original_filename):
    rfis = []

    try:
        doc = fitz.open(pdf_path)

        # Extract SK# from the filename only
        sk_number = extract_sk_number(original_filename)

        for page in doc:
            valid_annots = []
            blue_boxes = get_blue_boxes(page)

            # ---------------------------------------------------------------
            # PASS 1: PDF annotation objects (comments, text boxes, markups)
            # ---------------------------------------------------------------
            page_annots = page.annots()  # type: ignore
            if page_annots:
                for annot in page_annots:
                    info = annot.info
                    content = info.get('content', '')
                    if content and content.strip():
                        valid_annots.append({
                            'text': content.strip(),
                            'x0': annot.rect.x0,
                            'y0': annot.rect.y0,
                            'x1': annot.rect.x1,
                            'y1': annot.rect.y1,
                            'rect': annot.rect
                        })

            # ---------------------------------------------------------------
            # PASS 2: text layer, grouped by LINE (not by merged span) so that
            # two separate Q-labels/lines that PyMuPDF's span extraction would
            # otherwise glue together (e.g. "Q11\nQ12") stay distinct. This
            # also intentionally has no color filter - all colors are matched.
            # ---------------------------------------------------------------
            try:
                words = page.get_text("words")  # (x0,y0,x1,y1,word,block_no,line_no,word_no)

                # Group into LINES first (preserves natural reading order and
                # avoids PyMuPDF's span-level cross-line merging), then group
                # those lines into BLOCKS (a whole callout/text box is one
                # block_no). Grouping the final candidate by block - not by
                # individual line - is what lets a multi-line description
                # ("At the both magenta clouded opening / locations, the
                # opening extends...") survive as ONE entry instead of being
                # truncated to just its first line.
                line_map = {}
                for w in words:
                    x0, y0, x1, y1, word, block_no, line_no, word_no = w
                    lkey = (block_no, line_no)
                    if lkey not in line_map:
                        line_map[lkey] = {'words': [], 'x0': x0, 'y0': y0, 'x1': x1, 'y1': y1}
                    entry = line_map[lkey]
                    entry['words'].append((word_no, word))
                    entry['x0'] = min(entry['x0'], x0)
                    entry['y0'] = min(entry['y0'], y0)
                    entry['x1'] = max(entry['x1'], x1)
                    entry['y1'] = max(entry['y1'], y1)

                blocks = {}
                for (block_no, line_no), entry in line_map.items():
                    entry['words'].sort(key=lambda t: t[0])
                    line_text = ' '.join(w[1] for w in entry['words']).strip()
                    if not line_text:
                        continue
                    if block_no not in blocks:
                        blocks[block_no] = {'lines': [], 'x0': entry['x0'], 'y0': entry['y0'], 'x1': entry['x1'], 'y1': entry['y1']}
                    b = blocks[block_no]
                    b['lines'].append((line_no, line_text))
                    b['x0'] = min(b['x0'], entry['x0'])
                    b['y0'] = min(b['y0'], entry['y0'])
                    b['x1'] = max(b['x1'], entry['x1'])
                    b['y1'] = max(b['y1'], entry['y1'])

                for block_no, b in blocks.items():
                    b['lines'].sort(key=lambda t: t[0])
                    block_text = ' '.join(t[1] for t in b['lines']).strip()
                    # Include EVERY text block here, not just ones containing "Qn".
                    # Description text (any color) needs to be a candidate sibling
                    # for pairing too - restricting to Q-only text was silently
                    # dropping non-Q description boxes that aren't PDF annotation
                    # objects (i.e. plain drawn text on the page).
                    if block_text:
                        valid_annots.append({
                            'text': block_text,
                            'x0': b['x0'],
                            'y0': b['y0'],
                            'x1': b['x1'],
                            'y1': b['y1'],
                            'rect': fitz.Rect(b['x0'], b['y0'], b['x1'], b['y1'])
                        })
            except Exception as e:
                print(f"[RfiScript] Warning: Failed to extract text-layer lines: {e}")

            # ---------------------------------------------------------------
            # Deduplicate: group by Q-number (when present) with a wider
            # position tolerance, since an annotation .rect and a text-line
            # bbox for the SAME label commonly differ by more than 5pt.
            # Entries with no Q-number fall back to the original exact-text
            # + tight-position check.
            # ---------------------------------------------------------------
            unique_annots = []
            for a in valid_annots:
                qnum = get_q_num(a['text'])
                is_dup = False
                for ua in unique_annots:
                    ua_qnum = get_q_num(ua['text'])
                    if qnum and ua_qnum == qnum:
                        if abs(ua['x0'] - a['x0']) < 30 and abs(ua['y0'] - a['y0']) < 30:
                            is_dup = True
                            break
                    elif not qnum and ua['text'] == a['text'] and abs(ua['x0'] - a['x0']) < 5 and abs(ua['y0'] - a['y0']) < 5:
                        is_dup = True
                        break
                if not is_dup:
                    unique_annots.append(a)
            valid_annots = unique_annots

            # 2. Pair Q markers with their description boxes
            page_rfis = []

            for a in valid_annots:
                text = a['text']

                # Check if it's a STANDALONE Q marker (e.g. exactly "Q1" or "Q1.")
                standalone_match = re.match(r'^[*\-\s]*Q[\.\-\:\s]*(\d+[a-zA-Z]?)[\.:\-]?[\s]*$', text, re.IGNORECASE)
                if standalone_match:
                    rfi_num = f"Q{standalone_match.group(1).upper()}"

                    best_annot = {}
                    min_dist = float('inf')

                    for sibling in valid_annots:
                        if sibling == a:
                            continue
                        if re.match(r'^Q[\.\-\:]?\d+[a-zA-Z]?[\.\-\:]?$', sibling['text'], re.IGNORECASE):
                            continue

                        # Check if sibling text center is inside or directly enclosed by a blue box
                        cx_s = (sibling['x0'] + sibling['x1']) / 2
                        cy_s = (sibling['y0'] + sibling['y1']) / 2
                        s_pt = fitz.Point(cx_s, cy_s)
                        in_blue_box = False
                        for b_rect in blue_boxes:
                            expanded_b = b_rect + (-25, -25, 25, 25)
                            if expanded_b.contains(s_pt):
                                in_blue_box = True
                                break

                        # If blue boxes are present on the page, strictly require the candidate text to be inside a blue box
                        if blue_boxes and not in_blue_box:
                            continue

                        x_dist = max(0, max(a['x0'] - sibling['x1'], sibling['x0'] - a['x1']))
                        y_dist = max(0, max(a['y0'] - sibling['y1'], sibling['y0'] - a['y1']))
                        rect_dist = (x_dist**2 + y_dist**2)**0.5

                        cx_a, cy_a = (a['x0'] + a['x1'])/2, (a['y0'] + a['y1'])/2
                        cx_s, cy_s = (sibling['x0'] + sibling['x1'])/2, (sibling['y0'] + sibling['y1'])/2
                        center_dist = ((cx_a - cx_s)**2 + (cy_a - cy_s)**2)**0.5

                        overlap_bonus = len(sibling['text']) * 0.5 if rect_dist < 20 else 0
                        blue_box_bonus = 10000 if in_blue_box else 0
                        dist = rect_dist + 0.01 * center_dist - overlap_bonus - blue_box_bonus

                        if dist < min_dist and rect_dist < 300:
                            if (len(sibling['text']) > 5 or 'response' in sibling['text'].lower()) and len(sibling['text']) < 1500:
                                if is_drawing_note(sibling['text']):
                                    continue
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
                combined_match = re.match(r'^Q[\.\-\:\s]*(\d+[a-zA-Z]?)[\.\-\:\s]+(.+)', text, re.IGNORECASE | re.DOTALL)
                if combined_match:
                    desc = combined_match.group(2).strip()
                    # Prevent glued labels (e.g., "Q11 Q12") from being extracted as label + description
                    if re.match(r'^Q[\.\-\:]?\d+[a-zA-Z]?$', desc, re.IGNORECASE):
                        continue

                    rfi_num = f"Q{combined_match.group(1).upper()}"
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

            # Filter out RFIs with empty or invalid descriptions, and deduplicate by description text
            filtered_page_rfis = []
            seen_descriptions = set()
            for rfi in page_rfis:
                desc = str(rfi.get('description', '')).strip()
                if len(desc) >= 5 and not is_drawing_note(desc) and desc not in seen_descriptions:
                    seen_descriptions.add(desc)
                    filtered_page_rfis.append(rfi)

            # If main single-digit Q-numbers (Q1-Q9) exist on the page, filter out high secondary numbers (Q10+)
            has_main_q = any(re.match(r'^Q[1-9]$', r['rfiNumber'], re.IGNORECASE) for r in filtered_page_rfis)
            if has_main_q:
                filtered_page_rfis = [r for r in filtered_page_rfis if re.match(r'^Q[1-9]$', r['rfiNumber'], re.IGNORECASE)]

            page_rfis = filtered_page_rfis

            # 3. Process Responses and Status Keywords
            closed_keywords = ['confirmed', 'ok', 'approved', 'closed', 'resolved']

            for rfi in page_rfis:
                desc_text = str(rfi.get('description', ''))
                
                # Only drop if the description exactly equals "void", "closed", etc., or starts with "void "
                desc_lower = desc_text.strip().lower()
                if desc_lower in ['void', 'closed', 'deleted', 'cancelled'] or desc_lower.startswith('void '):
                    continue

                resp_match = re.search(r'\b(response|ans|answer)\s*:', desc_text, re.IGNORECASE)
                if resp_match:
                    start_idx = int(resp_match.start())
                    end_idx = int(resp_match.end())
                    rfi['response'] = desc_text[end_idx:].strip()  # type: ignore
                    rfi['description'] = desc_text[:start_idx].strip()  # type: ignore

                desc_rect = rfi['_rect']
                if desc_rect is None:
                    rfis.append(rfi)
                    continue
                drect = fitz.Rect(desc_rect)
                expanded_drect = drect + (-50, -50, 50, 50)

                skip_rfi = False
                for a in valid_annots:
                    if a['text'] == rfi['description'] or a['text'] == rfi['rfiNumber']:
                        continue

                    irect = fitz.Rect(a['rect'])
                    if expanded_drect.intersects(irect):
                        text_lower = a['text'].strip().lower()
                        
                        # Check for a specific stamp box that is just "VOID" or "CLOSED"
                        if text_lower in ['void', 'closed', 'deleted', 'cancelled']:
                            skip_rfi = True
                            break

                        words_set = set(re.findall(r'\b\w+\b', text_lower))
                        if any(k in words_set for k in closed_keywords):
                            rfi['status'] = 'CLOSED'

                        if text_lower.startswith('response:') or text_lower.startswith('ans:'):
                            parts = re.split(r'response:|ans:|answer:', a['text'], flags=re.IGNORECASE)
                            if len(parts) > 1:
                                rfi['response'] = parts[-1].strip()

                if not skip_rfi:
                    rfis.append(rfi)

        doc.close()

        # 4. Cleanup and Deduplicate across the whole document
        desc_owners = {}
        for r in rfis:
            rfi_num = r['rfiNumber']
            desc = r['description'].strip()
            if desc:
                if desc not in desc_owners:
                    desc_owners[desc] = set()
                desc_owners[desc].add(rfi_num)

        unique_rfis = {}
        for r in rfis:
            r.pop('_rect', None)
            rfi_num = r['rfiNumber']
            desc = r['description'].strip()

            if not desc:
                score = -20000
            else:
                score = len(desc)
                # Penalize descriptions claimed by multiple different RFI numbers
                if len(desc_owners.get(desc, set())) > 1:
                    score -= 10000

            if rfi_num not in unique_rfis:
                unique_rfis[rfi_num] = {'r': r, 'score': score}
            else:
                existing_r = unique_rfis[rfi_num]['r']
                existing_desc = existing_r['description'].strip().lower()
                current_desc = desc.lower()
                
                # Preserve both if they have completely different valid descriptions (e.g. drafter typo on drawing)
                if len(current_desc) > 20 and len(existing_desc) > 20:
                    if current_desc not in existing_desc and existing_desc not in current_desc:
                        counter = 2
                        new_rfi_num = f"{rfi_num} ({counter})"
                        while new_rfi_num in unique_rfis:
                            counter += 1
                            new_rfi_num = f"{rfi_num} ({counter})"
                        r['rfiNumber'] = new_rfi_num
                        unique_rfis[new_rfi_num] = {'r': r, 'score': score}
                        continue

                if score > unique_rfis[rfi_num]['score']:
                    unique_rfis[rfi_num] = {'r': r, 'score': score}

        final_rfis = [v['r'] for v in unique_rfis.values()]
        print(json.dumps({"success": True, "rfis": final_rfis}))

    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))

if __name__ == "__main__":
    if len(sys.argv) < 3:
        pass
    else:
        extract_rfi(sys.argv[1], sys.argv[2])