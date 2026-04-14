import subprocess, json
out = subprocess.run(["npx.cmd", "pyright", "src/scripts/extract_drawing.py", "--outputjson"], capture_output=True)
try:
    d = json.loads(out.stdout)
    with open("out_errors.txt", "w") as f:
        for err in d.get("generalDiagnostics", []):
            f.write(f"{err['range']['start']['line']+1}: {err['message']}\n")
except Exception as e:
    print(e)
    print(out.stdout)
