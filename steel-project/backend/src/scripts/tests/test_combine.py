import fitz
import glob
import os
import re
import json

def get_latest_pdf():
    files = glob.glob("uploads/rfis/**/*.pdf", recursive=True)
    if not files: return None
    return max(files, key=os.path.getmtime)

pdf_path = get_latest_pdf()
print("Testing on:", pdf_path)
doc = fitz.open(pdf_path)

rfis = []

for page in doc:
    valid_annots = []
    
    for annot in page.annots():
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
            
    # Remove duplicates if any (sometimes annotations are duplicated)
    unique_annots = []
    for a in valid_annots:
        if not any(ua['text'] == a['text'] and abs(ua['x0']-a['x0']) < 5 and abs(ua['y0']-a['y0']) < 5 for ua in unique_annots):
            unique_annots.append(a)
    valid_annots = unique_annots

    # Identify Q marks
    for a in valid_annots:
        text = a['text']
        
        # Is it a combined Q block? (e.g. "Q1 The architectural...")
        combined_match = re.match(r'^Q(\d+)[\.\-\:\s]+(.+)', text, re.IGNORECASE | re.DOTALL)
        if combined_match:
            rfi_num = f"Q{combined_match.group(1)}"
            desc = combined_match.group(2).strip()
            rfis.append({
                'rfiNumber': rfi_num,
                'description': desc,
                'response': '',
                'status': 'OPEN',
                'rect': a['rect']
            })
            continue

        # Is it a standalone Q block? (e.g. exactly "Q1" or "Q1.")
        standalone_match = re.match(r'^Q(\d+)[\.\-\:]?$', text, re.IGNORECASE)
        if standalone_match:
            rfi_num = f"Q{standalone_match.group(1)}"
            
            # Find the best sibling text box to be the description
            best_annot = None
            min_dist = float('inf')
            
            for sibling in valid_annots:
                if sibling == a: continue
                # Skip if sibling is exactly a Q marker itself
                if re.match(r'^Q(\d+)[\.\-\:]?$', sibling['text'], re.IGNORECASE): continue
                # Skip if it's very small text like "PAGE 01"
                if len(sibling['text']) < 15 and not re.search(r'\b(response|ans|answer)\b', sibling['text'], re.I):
                    continue
                    
                # Distance calculation
                # We want proximity, typically sibling is slightly below or intersecting
                dx = sibling['x0'] - a['x0']
                dy = sibling['y0'] - a['y0']
                dist = (dx**2 + dy**2)**0.5
                
                if dist < min_dist and dist < 400: # threshold to prevent taking text from across the page
                    min_dist = dist
                    best_annot = sibling
                    
            desc = best_annot['text'] if best_annot else ""
            rfis.append({
                'rfiNumber': rfi_num,
                'description': desc,
                'response': '',
                'status': 'OPEN',
                'rect': best_annot['rect'] if best_annot else a['rect']
            })

    # Find responses and statuses on this page for the rfis we just found
    closed_keywords = ['confirmed', 'ok', 'approved', 'closed', 'resolved']
    
    for rfi in rfis:
        if rfi.get('page_processed'): continue
        rfi['page_processed'] = True # only process once per page to avoid double counting

        # 1. Embedded responses in the description itself
        resp_match = re.search(r'\b(response|ans|answer)\s*:', rfi['description'], re.IGNORECASE)
        if resp_match:
            rfi['response'] = rfi['description'][resp_match.end():].strip()
            rfi['description'] = rfi['description'][:resp_match.start()].strip()
            
        # 2. Check for nearby text boxes that contain keywords or "response"
        # Since 'confirmed' was a separate text box inside or very close to the desc box
        desc_rect = rfi['rect']
        
        for a in valid_annots:
            if a['text'] == rfi['description'] or a['text'] == rfi.get('rfiNumber'):
                continue
            
            # Check overlap or extreme proximity to the description rect
            # A box is relevant if it intersects the description box OR is very close
            # We can use PyMuPDF rect intersection
            irect = fitz.Rect(a['rect'])
            drect = fitz.Rect(desc_rect)
            
            # expand drect slightly
            expanded_drect = drect + (-20, -20, 20, 20)
            
            if expanded_drect.intersects(irect):
                text_lower = a['text'].lower()
                words = set(re.findall(r'\b\w+\b', text_lower))
                
                # if it just says 'confirmed', it's a response
                if any(k in words for k in closed_keywords):
                    rfi['status'] = 'CLOSED'
                    if not rfi['response'] and 'confirmed' in words: rfi['response'] = 'Confirmed'
                    if not rfi['response'] and 'approved' in words: rfi['response'] = 'Approved'
                    if not rfi['response'] and 'ok' in words: rfi['response'] = 'OK'
                
                # if it is explicitly a response box
                elif text_lower.startswith('response:') or text_lower.startswith('ans:'):
                    parts = re.split(r'response:|ans:|answer:', a['text'], flags=re.IGNORECASE)
                    if len(parts) > 1:
                        rfi['response'] = parts[-1].strip()

# Cleanup final list
for r in rfis:
    r.pop('rect', None)
    r.pop('page_processed', None)

print(json.dumps(rfis, indent=2))
