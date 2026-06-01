from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
import shutil
import os
from pathlib import Path
import tempfile
from inference import get_latest_model, setup_predictor, process_pdf
from extraction import process_extracted_data
from extraction_steelfab import process_extracted_data as process_steelfab_data
from extraction_ironfab import process_extracted_data as process_ironfab_data

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global caches
model_cache = {}
default_model = None

# Model paths configuration
models_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), 'Models'))
MODEL_PATHS = {
    'steelfab': os.path.join(models_dir, 'steelfab_best.pt'),
    'ironfab': os.path.join(models_dir, 'ironfab_best.pt')
}

# Warm up default model on startup
try:
    default_model_path = get_latest_model()
    if default_model_path and default_model_path.exists():
        default_model = setup_predictor(str(default_model_path))
        print(f"[AI API] Default model loaded: {default_model_path}")
except Exception as e:
    print(f"Warning: Could not load default model: {e}")

def get_model_for_client(client_name: str):
    client_clean = (client_name or '').lower().replace(" ", "").replace("-", "")
    
    model_key = None
    if 'steelfab' in client_clean or 'steel' in client_clean:
        model_key = 'steelfab'
    elif 'ironfab' in client_clean or 'iron' in client_clean:
        model_key = 'ironfab'
        
    if model_key:
        path = MODEL_PATHS[model_key]
        if os.path.exists(path):
            if model_key not in model_cache:
                print(f"[AI API] Loading model for {model_key} from {path}...")
                model_cache[model_key] = setup_predictor(path)
            return model_cache[model_key]
        else:
            print(f"[AI API] Model file not found for {model_key} at {path}")

    # Fallback to the default model
    return default_model

@app.post("/upload")
async def extract_data(files: list[UploadFile] = File(...), client_name: str = Form(None)):
    results = {}
    
    # Get model based on client name
    target_model = get_model_for_client(client_name)
    if not target_model:
        return {"error": "Model not loaded properly or missing"}
    
    # Determine the processing function based on client name
    client_clean = (client_name or '').lower().replace(" ", "").replace("-", "")
    if 'steelfab' in client_clean or 'steel' in client_clean:
        formatter_func = process_steelfab_data
        print(f"[AI API] Using Steelfab post-processing formatter for client: {client_name}")
    elif 'ironfab' in client_clean or 'iron' in client_clean:
        formatter_func = process_ironfab_data
        print(f"[AI API] Using Ironfab post-processing formatter for client: {client_name}")
    else:
        formatter_func = process_extracted_data
        print(f"[AI API] Using default post-processing formatter for client: {client_name}")
        
    for idx, file in enumerate(files):
        print(f"[{idx+1}/{len(files)}] Processing: {file.filename} (client: {client_name})...")
        temp_fd, temp_path = tempfile.mkstemp(suffix=".pdf")
        os.close(temp_fd)
        
        with open(temp_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        try:
            # Run inference per pdf
            file_results = process_pdf(temp_path, target_model, original_filename=file.filename)
            processed_results = formatter_func(file_results)
            results[file.filename] = processed_results
            print(f"      - Found {len(file_results)} regions in {file.filename}")
        except Exception as e:
            print(f"      - Error processing {file.filename}: {e}")
            results[file.filename] = {"error": str(e)}
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)
                
    return results

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
