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


def extract_rfi(pdf_path, original_filename):
    rfis = []

    try:
        doc = fitz.open(pdf_path)

        # Extract SK# from the filename only
        sk_number = extract_sk_number(original_filename)

        for page in doc:
            valid_annots = []

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
                standalone_match = re.match(r'^[*\-\s]*Q\s*(\d+)[\.:\-]?[\s]*$', text, re.IGNORECASE)
                if standalone_match:
                    rfi_num = f"Q{standalone_match.group(1)}"

                    best_annot = {}
                    min_dist = float('inf')

                    for sibling in valid_annots:
                        if sibling == a:
                            continue
                        if re.match(r'^Q\d+[\.\-\:]?$', sibling['text'], re.IGNORECASE):
                            continue

                        x_dist = max(0, max(a['x0'] - sibling['x1'], sibling['x0'] - a['x1']))
                        y_dist = max(0, max(a['y0'] - sibling['y1'], sibling['y0'] - a['y1']))
                        rect_dist = (x_dist**2 + y_dist**2)**0.5

                        cx_a, cy_a = (a['x0'] + a['x1'])/2, (a['y0'] + a['y1'])/2
                        cx_s, cy_s = (sibling['x0'] + sibling['x1'])/2, (sibling['y0'] + sibling['y1'])/2
                        center_dist = ((cx_a - cx_s)**2 + (cy_a - cy_s)**2)**0.5

                        overlap_bonus = len(sibling['text']) * 0.5 if rect_dist < 20 else 0

                        dist = rect_dist + 0.01 * center_dist - overlap_bonus

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
                    # Find ALL Q-number occurrences on this raw line - not just
                    # the first. If two bare labels (e.g. "Q11  Q12") end up on
                    # the same raw text line, treating everything after the
                    # first match as its "description" would steal the second
                    # label's text, as happened with Q11 getting "Q12" here.
                    matches = list(re.finditer(r'\bQ\s*\d+\b', line, re.IGNORECASE))
                    if not matches:
                        continue

                    if len(matches) == 1:
                        m = matches[0]
                        rfi_num = re.sub(r'\s+', '', m.group(0)).upper()
                        desc = line.replace(m.group(0), '').strip(' :.-')
                        # Guard: if what's left still looks like a bare Q-label
                        # (or nothing at all), don't fabricate a description -
                        # leave it blank rather than borrowing another label's text.
                        if not desc or re.match(r'^Q\s*\d+[\.:\-]?$', desc, re.IGNORECASE):
                            desc = ''
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
                    else:
                        # Multiple bare labels sharing a raw line - these are
                        # standalone anchors with no attached text on this line;
                        # emit each with an empty description instead of one
                        # borrowing the other's label as its text.
                        for m in matches:
                            rfi_num = re.sub(r'\s+', '', m.group(0)).upper()
                            page_rfis.append({
                                'rfiNumber': rfi_num,
                                'refDrawing': original_filename,
                                'description': '',
                                'response': '',
                                'status': 'OPEN',
                                'remarks': '',
                                'skNumber': sk_number,
                                '_rect': None
                            })

            if not page_rfis:
                for a2 in valid_annots:
                    txt = a2['text']
                    fallback_match = re.search(r'\bQ\s*\d+\b', txt, re.IGNORECASE)
                    if fallback_match:
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

            # 3. Process Responses and Status Keywords
            closed_keywords = ['confirmed', 'ok', 'approved', 'closed', 'resolved']

            for rfi in page_rfis:
                desc_text = str(rfi.get('description', ''))
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

                for a in valid_annots:
                    if a['text'] == rfi['description'] or a['text'] == rfi['rfiNumber']:
                        continue

                    irect = fitz.Rect(a['rect'])
                    if expanded_drect.intersects(irect):
                        text_lower = a['text'].lower()
                        words_set = set(re.findall(r'\b\w+\b', text_lower))

                        if any(k in words_set for k in closed_keywords):
                            rfi['status'] = 'CLOSED'
                            if not rfi['response'] and 'confirmed' in words_set: rfi['response'] = 'Confirmed'
                            if not rfi['response'] and 'approved' in words_set: rfi['response'] = 'Approved'
                            if not rfi['response'] and 'ok' in words_set: rfi['response'] = 'OK'

                        if text_lower.startswith('response:') or text_lower.startswith('ans:'):
                            parts = re.split(r'response:|ans:|answer:', a['text'], flags=re.IGNORECASE)
                            if len(parts) > 1:
                                rfi['response'] = parts[-1].strip()

                rfis.append(rfi)

        doc.close()

        # 4. Cleanup and Deduplicate across the whole document
        unique_rfis = {}
        for r in rfis:
            r.pop('_rect', None)
            rfi_num = r['rfiNumber']

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