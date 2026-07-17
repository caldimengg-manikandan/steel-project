import sys
import json
import re
import fitz  # type: ignore

SKIP_WORDS = re.compile(r'\b(closed|void|cancelled|canceled|n/a)\b', re.IGNORECASE)
Q_LABEL_PAT = re.compile(r'^Q\s*[\-]?\s*(\d+)[\.\:\s]*(.*)', re.IGNORECASE | re.DOTALL)
# Tolerance for color matching (per RGB channel, 0-255 range)
COLOR_TOL = 40


def extract_sk_number(original_filename):
    sk_pattern = re.compile(r'SK[\s#\-_]*(\d+)', re.IGNORECASE)
    m = sk_pattern.search(original_filename)
    if m:
        num = int(m.group(1))
        return f"SK#{num}"
    return 'SK# - Unknown'


def unpack_color(c):
    """Normalize any PyMuPDF color to (R, G, B) tuple of ints 0-255, or None."""
    if c is None:
        return None
    if isinstance(c, int):
        return ((c >> 16) & 0xFF, (c >> 8) & 0xFF, c & 0xFF)
    if isinstance(c, float):
        ci = int(c)
        return ((ci >> 16) & 0xFF, (ci >> 8) & 0xFF, ci & 0xFF)
    if isinstance(c, (list, tuple)) and len(c) >= 3:
        vals = list(c[:3])
        if all(isinstance(v, float) and v <= 1.0 for v in vals):
            vals = [int(v * 255) for v in vals]
        return tuple(int(v) for v in vals)
    return None


def colors_close(c1, c2, tol=COLOR_TOL):
    """True if two colors are within tolerance on every channel."""
    r1, r2 = unpack_color(c1), unpack_color(c2)
    if r1 is None or r2 is None:
        return False
    return all(abs(a - b) <= tol for a, b in zip(r1, r2))


def get_span_color(block):
    """Return the color of the first non-empty span in a block."""
    for line in block.get('lines', []):
        for span in line.get('spans', []):
            if span.get('text', '').strip():
                return span.get('color')
    return None


def get_block_text(block):
    """Concatenate all span text in a block."""
    parts = []
    for line in block.get('lines', []):
        line_text = "".join(span.get('text', '') for span in line.get('spans', []))
        if line_text.strip():
            parts.append(line_text.strip())
    return "\n".join(parts)


def get_annot_color(annot):
    """Get best color from annotation (stroke > fill)."""
    colors = annot.colors
    return colors.get('stroke') or colors.get('fill')


def rect_center(bbox):
    return ((bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2)


def spatial_distance(b1_bbox, b2_bbox):
    c1 = rect_center(b1_bbox)
    c2 = rect_center(b2_bbox)
    return ((c1[0] - c2[0]) ** 2 + (c1[1] - c2[1]) ** 2) ** 0.5


def find_best_desc_block(q_block, all_blocks, page_w, page_h):
    """
    Find the description block for a Q label.
    Strategy:
      1. First try: block strictly below Q label with x-proximity.
      2. Fallback: nearest block in a wide search region (right side + below).
    Returns (desc_block, method) or (None, None).
    """
    q_x0, q_y0, q_x1, q_y1 = q_block['x0'], q_block['y0'], q_block['x1'], q_block['y1']
    q_h = max(q_y1 - q_y0, 8)
    q_w = max(q_x1 - q_x0, 15)

    best = None
    best_score = float('inf')

    for b in all_blocks:
        if b is q_block:
            continue
        bx0, by0, bx1, by1 = b['x0'], b['y0'], b['x1'], b['y1']

        # Must not be another Q label
        if Q_LABEL_PAT.match(b['text'].strip()):
            continue

        # Wide search region:
        #   - Vertically: from slightly above q_y0 to q_y1 + 20x label height
        #   - Horizontally: from q_x0 - 5*q_w  to  q_x1 + 20*q_w
        if by0 < q_y0 - q_h:
            continue
        if by0 > q_y1 + q_h * 20:
            continue
        if bx1 < q_x0 - q_w * 5:
            continue
        if bx0 > q_x1 + q_w * 20:
            continue

        # Score: prefer blocks closer to Q label
        dist = spatial_distance(
            (q_x0, q_y0, q_x1, q_y1),
            (bx0, by0, bx1, by1)
        )
        if dist < best_score:
            best_score = dist
            best = b

    return best


def extract_rfi(pdf_path, original_filename):
    rfis = []

    try:
        doc = fitz.open(pdf_path)
        sk_number = extract_sk_number(original_filename)

        for page in doc:
            page_w = page.rect.width
            page_h = page.rect.height
            text_dict = page.get_text("dict")
            raw_blocks = text_dict.get('blocks', [])

            # ── Build text block list ──────────────────────────────────────
            text_blocks = []
            for b in raw_blocks:
                if b.get('type') != 0:
                    continue
                text = get_block_text(b)
                if not text:
                    continue
                color = get_span_color(b)
                bbox = b.get('bbox', [0, 0, 0, 0])
                text_blocks.append({
                    'x0': bbox[0], 'y0': bbox[1],
                    'x1': bbox[2], 'y1': bbox[3],
                    'text': text,
                    'color': color,
                    'source': 'text',
                })

            # ── Also collect annotation objects ────────────────────────────
            # Annotation content fields often hold the full question text.
            annot_items = []
            for annot in page.annots():
                ct = (annot.info.get('content') or '').strip()
                if not ct:
                    ct = (annot.info.get('subject') or '').strip()
                if not ct:
                    continue
                r = annot.rect
                ac = get_annot_color(annot)
                annot_items.append({
                    'x0': r.x0, 'y0': r.y0,
                    'x1': r.x1, 'y1': r.y1,
                    'text': ct,
                    'color': ac,
                    'source': 'annot',
                })

            all_items = text_blocks + annot_items

            # ── Step 1: Find Q-label blocks (text blocks AND annotations) ──
            for q_block in all_items:
                q_match = Q_LABEL_PAT.match(q_block['text'])
                if not q_match:
                    continue

                rfi_num = f"Q{q_match.group(1)}"
                inline_desc = q_match.group(2).strip()
                q_color = q_block['color']

                # ── Step 2: Find the best description block ────────────────
                # Priority: annotation items first (they hold full text),
                # then text_blocks.
                desc_item = None
                best_score = (float('inf'), float('inf'))

                q_cx, q_cy = rect_center((q_block['x0'], q_block['y0'],
                                          q_block['x1'], q_block['y1']))
                q_h = max(q_block['y1'] - q_block['y0'], 8)
                q_w = max(q_block['x1'] - q_block['x0'], 15)

                for item in all_items:
                    if item is q_block:
                        continue
                    # Skip other Q labels
                    if Q_LABEL_PAT.match(item['text'].strip()):
                        continue
                    bx0, by0, bx1, by1 = item['x0'], item['y0'], item['x1'], item['y1']

                    # Search radius (allow above, below, left, right)
                    max_dist = max(q_w, q_h) * 50
                    if bx1 < q_block['x0'] - max_dist or bx0 > q_block['x1'] + max_dist:
                        continue
                    if by1 < q_block['y0'] - max_dist or by0 > q_block['y1'] + max_dist:
                        continue

                    dist = ((q_cx - (bx0 + bx1) / 2) ** 2 +
                            (q_cy - (by0 + by1) / 2) ** 2) ** 0.5

                    # Tier scoring: color-matched items always rank above non-matched,
                    # then by source (annotation > text), then by distance.
                    color_matched = colors_close(q_color, item['color'])
                    if color_matched:
                        tier = 0  # best: color match
                    else:
                        tier = 1  # fallback: no color match

                    # Within same tier, prefer annotations (full text) then distance
                    src_bonus = 0.5 if item['source'] == 'annot' else 1.0
                    score = (tier, dist * src_bonus)

                    if score < best_score:
                        best_score = score
                        desc_item = item

                # ── Step 3: Color-match validation ─────────────────────────
                if not inline_desc and desc_item is None:
                    continue

                if desc_item is not None:
                    desc_color = desc_item['color']
                    # Allow color match within tolerance, or if either color is None
                    if q_color is not None and desc_color is not None:
                        if not colors_close(q_color, desc_color):
                            continue  # Color mismatch — skip

                    # If desc_item is an annotation, it has the full text already.
                    # If it's a text block, gather ALL same-color nearby blocks
                    # (question text is often split across multiple text blocks).
                    if desc_item['source'] == 'annot':
                        desc = desc_item['text']
                    else:
                        # Collect all items with same color in the search region
                        # (sorted by reading order: top-to-bottom, left-to-right)
                        same_color_items = []
                        for item in all_items:
                            if item is q_block:
                                continue
                            if Q_LABEL_PAT.match(item['text'].strip()):
                                continue
                            if not colors_close(q_color, item['color']):
                                continue
                            bx0, by0, bx1, by1 = item['x0'], item['y0'], item['x1'], item['y1']
                            # Search radius (allow above, below, left, right)
                            max_dist = max(q_w, q_h) * 50
                            if bx1 < q_block['x0'] - max_dist or bx0 > q_block['x1'] + max_dist:
                                continue
                            if by1 < q_block['y0'] - max_dist or by0 > q_block['y1'] + max_dist:
                                continue
                            same_color_items.append(item)

                        # Sort by reading order (top-to-bottom, left-to-right)
                        same_color_items.sort(key=lambda i: (round(i['y0'] / 5) * 5, i['x0']))
                        desc = '\n'.join(i['text'] for i in same_color_items) if same_color_items else desc_item['text']
                else:
                    desc = inline_desc

                # ── Step 4: Skip if cancellation words found ───────────────
                if SKIP_WORDS.search(desc):
                    continue
                if SKIP_WORDS.search(q_block['text']):
                    continue

                # ── Step 5: Split description / response ───────────────────
                response_text = ""
                resp_match = re.search(r'\b(response|ans|answer)\s*:', desc, re.IGNORECASE)
                if resp_match:
                    response_text = desc[resp_match.end():].strip()
                    desc = desc[:resp_match.start()].strip()

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

        # ── Deduplicate: keep entry with longest description ───────────────
        unique_rfis = {}
        for r in rfis:
            key = r['rfiNumber']
            if key not in unique_rfis or len(r['description']) > len(unique_rfis[key]['description']):
                unique_rfis[key] = r

        print(json.dumps({"success": True, "rfis": list(unique_rfis.values())}))

    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))


if __name__ == "__main__":
    if len(sys.argv) > 2:
        extract_rfi(sys.argv[1], sys.argv[2])
