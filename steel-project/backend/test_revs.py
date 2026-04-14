import os, glob, json, sys, re
import pdfplumber # type: ignore

# Add the current directory to sys.path to ensure 'src' is found as a package
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from src.scripts.extract_drawing import extract_locally # type: ignore

def main():
    pdf_dir = r'c:/Users/vibhu/Downloads/Steel/det/backend/uploads/drawings/69a7c7fa2455f9cd732c94cc'
    pdfs = glob.glob(os.path.join(pdf_dir, '*.pdf'))
    
    with open('output.txt', 'w') as f:
        count = 0
        for p in pdfs:
            if count >= 5:
                break
            count += 1
            
            try:
                res = extract_locally(p)
                f.write(f'\n--- {os.path.basename(p)} ---\n')
                f.write(json.dumps(res.get('revisionHistory')) + '\n')
                
                # Print matches directly
                with pdfplumber.open(p) as pdf:
                    clean_text = pdf.pages[0].extract_text(layout=True, x_tolerance=2.0)
                    f.write("RAW MATCHES:\n")
                    
                    # Pattern 1
                    rev_rows_new = re.findall(r'^\s*\d+\s+([A-Z0-9]{1,2})\s+(.*?)\s+(\d{2}[-/]\d{2}[-/]\d{4})\s*$', clean_text, re.I | re.M)
                    f.write(f"rev_rows_new: {rev_rows_new}\n")
                    
                    # Pattern 2
                    rev_rows_date_first = re.findall(r'\b([A-Z0-9]{1,2}|REV\s[A-Z0-9]{1,2})\b\s+([A-Z]{2,3})\b\s+\b([A-Z]{3}\s+\d{1,2}\s+\d{4})\b\s+(.*)', clean_text, re.I)
                    f.write(f"rev_rows_date_first: {rev_rows_date_first}\n")
                    
                    # Pattern 3
                    rev_rows_desc_first = re.findall(r'\b([A-Z0-9]{1,2}|REV\s[A-Z0-9]{1,2})\b\s+([A-Z]{2,3})\b\s+(.*?)\s+\b([A-Z]{3}\s+\d{1,2}\s+\d{4})\b', clean_text, re.I)
                    f.write(f"rev_rows_desc_first: {rev_rows_desc_first}\n")
                    
                    # Pattern 4
                    rev_num = re.findall(r'\b([A-Z0-9]{1,2})\b\s+([A-Z]{2,3})\b\s+\b(\d{2}[-/]\d{2}[-/]\d{4}|\d{4}[-/]\d{2}[-/]\d{2})\b\s+(.*)', clean_text, re.I)
                    f.write(f"rev_num: {rev_num}\n")
            except Exception as e:
                f.write(f'Error: {e}\n')

if __name__ == "__main__":
    main()
