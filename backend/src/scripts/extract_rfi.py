import sys
import json
import re
import fitz  # type: ignore

def extract_sk_number(original_filename):
    sk_pattern = re.compile(r'SK[\s#\-_]*(\d+)', re.IGNORECASE)
    m = sk_pattern.search(original_filename)
    if m:
        num = int(m.group(1))
        return f"SK#{num}"
    return 'SK# - Unknown'

def extract_rfi(pdf_path, original_filename):
    rfis = []
    
    try:
        doc = fitz.open(pdf_path)
        sk_number = extract_sk_number(original_filename)
        
        for page in doc:
            # Get all text blocks on the page
            # format: (x0, y0, x1, y1, "text", block_no, block_type)
            blocks = page.get_text("blocks")
            text_blocks = []
            
            for b in blocks:
                # block_type == 0 means text
                if b[6] == 0:
                    text = b[4].strip()
                    if text:
                        text_blocks.append({
                            'x0': b[0],
                            'y0': b[1],
                            'x1': b[2],
                            'y1': b[3],
                            'text': text,
                            'cx': (b[0] + b[2]) / 2,
                            'cy': (b[1] + b[3]) / 2
                        })
                        
            # Find Q markers
            q_markers = []
            for b in text_blocks:
                # Matches "Q1", "Q 2", "Q1.", "Q-3"
                if re.match(r'^Q\s*[\-]?\s*\d+[\.\:]?$', b['text'], re.IGNORECASE):
                    q_markers.append(b)
                elif re.match(r'^Q\s*[\-]?\s*\d+[\.\:\s]+', b['text'], re.IGNORECASE):
                    # Combined marker (Q1 Some text)
                    q_markers.append(b)

            for q_block in q_markers:
                q_text = q_block['text']
                
                # Check if it's a standalone Q marker
                standalone_match = re.match(r'^Q\s*[\-]?\s*(\d+)[\.\:]?$', q_text, re.IGNORECASE)
                
                if standalone_match:
                    rfi_num = f"Q{standalone_match.group(1)}"
                    
                    # Find the box directly below it (or closest)
                    best_desc_block = None
                    min_dist = float('inf')
                    
                    for b in text_blocks:
                        if b == q_block: continue
                        if re.match(r'^Q\s*[\-]?\s*\d+[\.\:]?$', b['text'], re.IGNORECASE): continue
                        
                        # Calculate distance
                        x_dist = max(0, max(q_block['x0'] - b['x1'], b['x0'] - q_block['x1']))
                        y_dist = max(0, max(q_block['y0'] - b['y1'], b['y0'] - q_block['y1']))
                        dist = (x_dist**2 + y_dist**2)**0.5
                        
                        if dist < min_dist and dist < 1000:
                            min_dist = dist
                            best_desc_block = b
                            
                    desc = best_desc_block['text'] if best_desc_block else ""
                else:
                    # Combined marker
                    m = re.match(r'^Q\s*[\-]?\s*(\d+)[\.\:\s]+(.*)', q_text, re.IGNORECASE | re.DOTALL)
                    if m:
                        rfi_num = f"Q{m.group(1)}"
                        desc = m.group(2).strip()
                    else:
                        continue
                
                # Check if it's closed (either in description or nearby boxes)
                is_closed = False
                
                # Check description text itself
                if re.search(r'\bclosed\b', desc, re.IGNORECASE):
                    is_closed = True
                    
                # Check nearby text blocks for the word "closed" or "overwritten as closed"
                if not is_closed:
                    for b in text_blocks:
                        if re.search(r'\bclosed\b', b['text'], re.IGNORECASE):
                            # Is this block near the Q marker or description?
                            dist_to_q = max(0, max(q_block['x0'] - b['x1'], b['x0'] - q_block['x1'])) + max(0, max(q_block['y0'] - b['y1'], b['y0'] - q_block['y1']))
                            if dist_to_q < 200:
                                is_closed = True
                                break
                                
                if is_closed:
                    # Skip extracting this one
                    continue
                    
                # Clean up response if it's in the description
                response_text = ""
                resp_match = re.search(r'\b(response|ans|answer)\s*:', desc, re.IGNORECASE)
                if resp_match:
                    start_idx = int(resp_match.start())
                    end_idx = int(resp_match.end())
                    response_text = desc[end_idx:].strip()
                    desc = desc[:start_idx].strip()

                rfis.append({
                    'rfiNumber': rfi_num,
                    'refDrawing': original_filename,
                    'description': desc,
                    'response': response_text,
                    'status': 'OPEN',
                    'remarks': '',
                    'skNumber': sk_number
                })

        doc.close()

        # Deduplicate
        unique_rfis = {}
        for r in rfis:
            rfi_num = r['rfiNumber']
            if rfi_num not in unique_rfis:
                unique_rfis[rfi_num] = r
            else:
                if len(r['description']) > len(unique_rfis[rfi_num]['description']):
                    unique_rfis[rfi_num] = r
                    
        print(json.dumps({"success": True, "rfis": list(unique_rfis.values())}))

    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))

if __name__ == "__main__":
    if len(sys.argv) > 2:
        extract_rfi(sys.argv[1], sys.argv[2])
