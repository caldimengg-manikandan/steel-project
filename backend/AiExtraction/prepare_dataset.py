import json
import os
import re
import shutil
from pathlib import Path
from sklearn.model_selection import train_test_split


def normalize_filename(filename: str) -> str:
    """
    Normalize filename for robust matching:
    - Lowercase
    - Strip extension
    - Remove 'copy', 'page_N', 'rev'
    - Remove all non-alphanumeric characters
    """
    name = Path(filename).stem.lower()
    # Remove Label Studio copy suffixes
    name = re.sub(r'(_copy(_\d+)?)+', '', name)
    # Remove 'rev' and 'page' keywords
    name = re.sub(r'rev', '', name)
    name = re.sub(r'page_\d+', '', name)
    name = re.sub(r'page', '', name)
    # Remove all non-alphanumeric
    name = re.sub(r'[^a-z0-9]', '', name)
    return name


def find_image(images_dir: Path, filename: str):
    """
    Try multiple strategies to locate an image.
    1. Exact match
    2. Normalized match (ignoring case, punctuation, and common keywords)
    """
    # 1. Direct check
    p = images_dir / filename
    if p.exists():
        return p, filename

    # 2. Normalized check
    target = normalize_filename(filename)
    
    # Cache the images directory listing for efficiency
    if not hasattr(find_image, "_cache"):
        find_image._cache = {normalize_filename(f.name): f for f in images_dir.iterdir() if f.is_file()}
    
    if target in find_image._cache:
        res = find_image._cache[target]
        return res, res.name

    # 3. Fallback: try stripping trailing characters from target
    t = target
    while len(t) > 3:
        t = t[:-1]
        if t in find_image._cache:
            res = find_image._cache[t]
            return res, res.name
        
        # Also try matching against cached names that were also stripped
        for cache_name, res in find_image._cache.items():
            c = cache_name
            while len(c) > 3:
                c = c[:-1]
                if c == t:
                    return res, res.name
    
    # 4. Try matching if the target is a substring of any cached name or vice-versa
    for cache_name, res in find_image._cache.items():
        if len(target) > 4 and (target in cache_name or cache_name in target):
            return res, res.name

    return None, None

    return None, None



def convert_ls_to_yolo(annotation_file='annotations.json'):
    with open(annotation_file, 'r') as f:
        data = json.load(f)

    classes    = ["REVISION_TABLE", "DRAWING_NO", "DRAWING_DESCRIPTION", "PROJECT_NO"]
    cls_to_id  = {cls: i for i, cls in enumerate(classes)}

    base_dir   = Path("datasets/drawings")
    images_dir = Path("images")

    # Clean & recreate split directories
    for split in ['train', 'val']:
        for sub in ['images', 'labels']:
            d = base_dir / sub / split
            if d.exists():
                shutil.rmtree(d)
            d.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------ #
    # Collect valid tasks
    # ------------------------------------------------------------------ #
    valid_tasks = []   # list of (task, src_img_path, dest_img_name)
    skipped     = []

    for task in data:
        if not task.get('annotations'):
            skipped.append((task.get('file_upload', '?'), 'no annotations'))
            continue

        full_filename = task['file_upload']
        parts = full_filename.split('-', 1)
        original_filename = parts[1] if len(parts) > 1 else full_filename

        img_path, resolved_name = find_image(images_dir, original_filename)

        if img_path is None:
            # Debug some specific ones
            if "E-03.01" in original_filename or "E-03.05" in original_filename:
                target = normalize_filename(original_filename)
                # print(f"DEBUG: Failed to match {original_filename} (normalized: {target})")
            skipped.append((original_filename, 'image not found'))
            continue

        # Use the annotation filename as the destination name so each
        # copy entry becomes a separate training sample (same pixels, same labels)
        dest_name = original_filename.replace(' ', '_')   # normalise spaces

        valid_tasks.append((task, img_path, dest_name))

    # ------------------------------------------------------------------ #
    # Report
    # ------------------------------------------------------------------ #
    print(f"Valid tasks : {len(valid_tasks)}")
    print(f"Skipped     : {len(skipped)}")
    if skipped:
        print("\nSkipped entries:")
        for name, reason in skipped:
            print(f"  {name}  [{reason}]")

    if not valid_tasks:
        print("\nERROR: No valid tasks. Check that your images/ folder contains the labelled images.")
        return

    # ------------------------------------------------------------------ #
    # Train / val split
    # ------------------------------------------------------------------ #
    if len(valid_tasks) < 2:
        train_tasks, val_tasks = valid_tasks, []
    else:
        train_tasks, val_tasks = train_test_split(
            valid_tasks, test_size=0.2, random_state=42
        )

    # ------------------------------------------------------------------ #
    # Write images + labels
    # ------------------------------------------------------------------ #
    def process_split(tasks, split):
        count = 0
        for task, img_path, dest_name in tasks:
            # Image
            dest_img = base_dir / "images" / split / dest_name
            shutil.copy(img_path, dest_img)

            # Label
            label_path = base_dir / "labels" / split / (Path(dest_name).stem + ".txt")
            with open(label_path, 'w') as lf:
                for ann in task['annotations'][0]['result']:
                    if ann['type'] not in ['labels', 'rectanglelabels']:
                        continue
                    label_key = 'labels' if 'labels' in ann['value'] else 'rectanglelabels'
                    label = ann['value'][label_key][0]
                    if label not in cls_to_id:
                        continue

                    cls_id   = cls_to_id[label]
                    x_perc   = ann['value']['x']
                    y_perc   = ann['value']['y']
                    w_perc   = ann['value']['width']
                    h_perc   = ann['value']['height']

                    x_center = (x_perc + w_perc / 2) / 100
                    y_center = (y_perc + h_perc / 2) / 100
                    width    = w_perc / 100
                    height   = h_perc / 100

                    lf.write(f"{cls_id} {x_center:.6f} {y_center:.6f} {width:.6f} {height:.6f}\n")
            count += 1
        return count

    train_count = process_split(train_tasks, 'train')
    val_count   = process_split(val_tasks,   'val')

    print(f"\nDataset ready  ->  {base_dir.absolute()}")
    print(f"  train : {train_count} images + labels")
    print(f"  val   : {val_count}   images + labels")

    # ------------------------------------------------------------------ #
    # data.yaml
    # ------------------------------------------------------------------ #
    yaml_content = f"""path: {base_dir.absolute()}
train: images/train
val: images/val

nc: {len(classes)}
names:
  0: REVISION_TABLE
  1: DRAWING_NO
  2: DRAWING_DESCRIPTION
  3: PROJECT_NO
"""
    with open('data.yaml', 'w') as f:
        f.write(yaml_content)

    print("\ndata.yaml written successfully.")


if __name__ == "__main__":
    convert_ls_to_yolo()
