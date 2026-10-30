import torch
import shutil
import os
from pathlib import Path
from ultralytics import YOLO

# -----------------------------------------------------------------------
# FINE-TUNE from steelfab base model (identical pipeline to steelfab & ironfab)
# -----------------------------------------------------------------------
OLD_MODEL = Path("Models/steelfab_best.pt")
FALLBACK  = "yolo11s.pt"

def train_yolo():
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"[Hardware] Using device: {device}")

    if OLD_MODEL.exists():
        print(f"[Fine-tune] Loading base model: {OLD_MODEL}")
        model = YOLO(str(OLD_MODEL))
    else:
        print(f"[WARNING] Base model not found at {OLD_MODEL}.")
        print(f"[Fallback] Starting from pretrained {FALLBACK} instead.")
        model = YOLO(FALLBACK)

    # Identical hyperparameter configuration as steelfab and ironfab
    results = model.train(
        data="data.yaml",

        # ---- Training length ----
        epochs=80,
        patience=20,

        # ---- Image / batch ----
        imgsz=1280,          # High resolution for small engineering drawing details
        batch=8,

        # ---- Hardware ----
        device=device,
        workers=0,

        # ---- Output ----
        project="runs/detect",
        name="finetune",
        exist_ok=True,
        plots=True,
        verbose=True,

        # ---- Learning rate ----
        lr0=0.001,           # Lower learning rate for fine-tuning
        lrf=0.01,

        # ---- Augmentation ----
        single_cls=False,
        rect=True,

        degrees=8.0,
        translate=0.08,
        scale=0.15,
        shear=0.0,
        perspective=0.0,

        flipud=0.0,
        fliplr=0.0,

        mosaic=0.2,
        mixup=0.0,
        copy_paste=0.0,

        hsv_h=0.0,
        hsv_s=0.0,
        hsv_v=0.05,

        close_mosaic=10,
    )

    print("\n=== Fine-tuning complete ===")
    
    # Store weights in Models/ exactly matching steelfab & ironfab convention
    models_dir = Path("Models")
    models_dir.mkdir(exist_ok=True)
    
    # Look for best.pt in possible ultralytics output locations
    candidate_paths = [
        Path("runs/detect/finetune/weights/best.pt"),
        Path("runs/detect/runs/detect/finetune/weights/best.pt")
    ]
    
    saved = False
    for p in candidate_paths:
        if p.exists():
            target_best = models_dir / "rastiron_best.pt"
            shutil.copy2(p, target_best)
            print(f"[SUCCESS] Saved model to: {target_best}")
            saved = True
            break
            
    if not saved:
        print("[WARNING] Could not find best.pt in runs/detect/finetune/weights/. Check the run directory.")

if __name__ == "__main__":
    if not os.path.exists("data.yaml"):
        print("ERROR: data.yaml not found! Run prepare_dataset.py first.")
    else:
        train_yolo()
