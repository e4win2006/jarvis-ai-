import os
import subprocess
import time
import json
import argparse
import sys

def verify_process_running(process_name, delay=1.0):
    time.sleep(delay)
    try:
        output = subprocess.check_output("tasklist", shell=True).decode('utf-8', errors='ignore')
        return process_name.lower() in output.lower()
    except Exception:
        return False

def open_pdfs(folder_arg):
    # Resolve desktop path or specified directory
    user_profile = os.environ.get('USERPROFILE', '')
    if not user_profile:
        return {"success": False, "reason": "USERPROFILE environment variable is not defined."}
    
    if folder_arg == 'desktop':
        target_dir = os.path.join(user_profile, 'Desktop')
    elif folder_arg == 'downloads':
        target_dir = os.path.join(user_profile, 'Downloads')
    elif folder_arg == 'documents':
        target_dir = os.path.join(user_profile, 'Documents')
    else:
        target_dir = folder_arg if os.path.exists(folder_arg) else os.path.join(user_profile, 'Desktop')
        
    if not os.path.exists(target_dir):
        return {"success": False, "reason": f"Directory '{target_dir}' does not exist."}

    # Find PDF files
    pdf_files = [f for f in os.listdir(target_dir) if f.lower().endswith('.pdf')]
    if not pdf_files:
        return {"success": False, "reason": f"No PDF files found in {os.path.basename(target_dir)}."}

    opened_files = []
    errors = []
    for file in pdf_files:
        full_path = os.path.join(target_dir, file)
        try:
            os.startfile(full_path)
            opened_files.append(file)
        except Exception as e:
            errors.append(f"Failed to open '{file}': {str(e)}")

    if opened_files:
        time.sleep(1.0)
        return {
            "success": True,
            "opened": len(opened_files),
            "files": opened_files,
            "errors": errors if errors else None
        }
    else:
        return {
            "success": False,
            "reason": "Failed to open any PDF files.",
            "errors": errors
        }

def launch_app(app_name):
    app_map = {
        "notepad": "notepad.exe",
        "calculator": "calc.exe",
        "paint": "mspaint.exe",
        "cmd": "cmd.exe",
        "powershell": "powershell.exe",
        "spotify": "spotify.exe"
    }
    target = app_map.get(app_name.lower(), app_name)
    try:
        subprocess.Popen(target, shell=True)
        # Verify process running after a short delay
        base_name = os.path.basename(target).lower()
        if verify_process_running(base_name, 1.0):
            return {
                "success": True,
                "message": f"Successfully launched {app_name}.",
                "process": base_name
            }
        else:
            return {
                "success": True,
                "message": f"Launched {app_name}, but could not confirm running process in tasklist.",
                "process": base_name
            }
    except Exception as e:
        return {
            "success": False,
            "reason": f"Failed to launch {app_name}: {str(e)}"
        }

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--action', required=True, choices=['open_pdfs', 'launch'])
    parser.add_argument('--folder', default='desktop')
    parser.add_argument('--app_name')
    args = parser.parse_args()

    result = {}
    if args.action == 'open_pdfs':
        result = open_pdfs(args.folder)
    elif args.action == 'launch':
        if not args.app_name:
            result = {"success": False, "reason": "Missing --app_name for launch action."}
        else:
            result = launch_app(args.app_name)

    print(json.dumps(result, indent=2))

if __name__ == '__main__':
    main()
