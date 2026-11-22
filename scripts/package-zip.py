#!/usr/bin/env python3
import os
import sys
import json
import zipfile

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUTPUT_ZIP_NAME = "mgammon-duo-cpanel-deploy.zip"
OUTPUT_ZIP_PATH = os.path.join(ROOT_DIR, OUTPUT_ZIP_NAME)

INCLUDE_ITEMS = [
    "app.cjs",
    "package.json",
    ".env.example",
    "DEPLOYMENT_CPANEL.md",
    "dist",
    "public",
    "database/schema.sql",
]

OPTIONAL_ITEMS = [
    "package-lock.json",
]

def is_forbidden(rel_path):
    # Normalize separators
    normalized = rel_path.replace("\\", "/")
    parts = normalized.split("/")
    
    # Check each path component
    for p in parts:
        if p.startswith(".env") and p != ".env.example":
            return True
        if p in [".data", "node_modules", "tests", ".git", "coverage", ".DS_Store", "__pycache__", "scripts", "aistudio"]:
            return True
        if p.endswith(".log"):
            return True
    return False

def create_package():
    # Remove old archive if exists
    if os.path.exists(OUTPUT_ZIP_PATH):
        try:
            os.remove(OUTPUT_ZIP_PATH)
        except Exception:
            pass

    added_files = []

    items_to_pack = list(INCLUDE_ITEMS)
    for opt in OPTIONAL_ITEMS:
        if os.path.exists(os.path.join(ROOT_DIR, opt)):
            items_to_pack.append(opt)

    with zipfile.ZipFile(OUTPUT_ZIP_PATH, "w", zipfile.ZIP_DEFLATED) as zf:
        for item in items_to_pack:
            full_path = os.path.join(ROOT_DIR, item)
            if not os.path.exists(full_path):
                raise FileNotFoundError(f"Required item missing for release package: {item}")
            
            if item == "package.json":
                # Ensure the packaged package.json has start: node app.cjs, only production run scripts,
                # and only the 7 actual server runtime dependencies required by app.cjs with public-npm-compatible ranges
                with open(full_path, "r", encoding="utf-8") as pf:
                    pkg_data = json.load(pf)
                pkg_data.pop("type", None)
                pkg_data.pop("devDependencies", None)
                pkg_data["main"] = "app.cjs"
                pkg_data["engines"] = {
                    "node": ">=20.0.0"
                }
                pkg_data["scripts"] = {
                    "start": "node app.cjs",
                    "start:prod": "NODE_ENV=production node app.cjs"
                }
                pkg_data["dependencies"] = {
                    "bcryptjs": ">=2.4.3 <4.0.0",
                    "cookie-parser": "^1.4.7",
                    "dotenv": ">=16.4.5 <18.0.0",
                    "express": "^4.21.2",
                    "jalaali-js": ">=1.2.8 <3.0.0",
                    "mysql2": ">=3.11.0 <4.0.0",
                    "xlsx": "^0.18.5"
                }
                pkg_content = json.dumps(pkg_data, indent=2, ensure_ascii=False) + "\n"
                zf.writestr("package.json", pkg_content)
                added_files.append({"name": "package.json", "size": len(pkg_content.encode("utf-8"))})
                continue

            if os.path.isfile(full_path):
                if not is_forbidden(item):
                    zf.write(full_path, item)
                    added_files.append({"name": item, "size": os.path.getsize(full_path)})
            elif os.path.isdir(full_path):
                for r, dirs, files in os.walk(full_path):
                    for f in sorted(files):
                        fp = os.path.join(r, f)
                        rel = os.path.relpath(fp, ROOT_DIR)
                        if rel == OUTPUT_ZIP_NAME:
                            continue
                        if not is_forbidden(rel):
                            zf.write(fp, rel)
                            added_files.append({"name": rel, "size": os.path.getsize(fp)})

    # Verify output zip
    with zipfile.ZipFile(OUTPUT_ZIP_PATH, "r") as zf:
        infolist = zf.infolist()
        for member in infolist:
            fn = member.filename
            if is_forbidden(fn):
                raise ValueError(f"SECURITY ALERT: Forbidden file packed in zip: {fn}")
        
    stat = os.stat(OUTPUT_ZIP_PATH)
    result = {
        "zipPath": OUTPUT_ZIP_PATH,
        "sizeBytes": stat.st_size,
        "fileCount": len(added_files),
        "files": added_files,
    }
    print(json.dumps(result))

if __name__ == "__main__":
    try:
        create_package()
    except Exception as e:
        sys.stderr.write(f"Error creating package: {e}\n")
        sys.exit(1)
