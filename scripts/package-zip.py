#!/usr/bin/env python3
import os
import sys
import json
import zipfile
import tempfile
import subprocess

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

PRODUCTION_DEPENDENCIES = {
    "bcryptjs": "^3.0.2",
    "cookie-parser": "^1.4.7",
    "dotenv": "^16.4.7",
    "express": "^4.21.2",
    "jalaali-js": "^1.2.8",
    "mysql2": "^3.11.5",
    "xlsx": "^0.18.5",
}

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

def build_production_manifest_and_lockfile(source_pkg_path):
    with open(source_pkg_path, "r", encoding="utf-8") as pf:
        pkg_data = json.load(pf)

    prod_pkg = {
        "name": pkg_data.get("name", "mgammon-duo"),
        "private": True,
        "version": pkg_data.get("version", "1.0.0"),
        "main": "app.cjs",
        "engines": {
            "node": ">=20.0.0"
        },
        "scripts": {
            "start": "node app.cjs",
            "start:prod": "NODE_ENV=production node app.cjs"
        },
        "dependencies": dict(PRODUCTION_DEPENDENCIES),
    }
    pkg_content = json.dumps(prod_pkg, indent=2, ensure_ascii=False) + "\n"

    with tempfile.TemporaryDirectory(prefix="mgammon_prod_lock_") as tmp_dir:
        tmp_pkg_path = os.path.join(tmp_dir, "package.json")
        with open(tmp_pkg_path, "w", encoding="utf-8") as f:
            f.write(pkg_content)

        subprocess.run(
            [
                "npm",
                "install",
                "--package-lock-only",
                "--omit=dev",
                "--ignore-scripts",
                "--no-audit",
                "--no-fund",
            ],
            cwd=tmp_dir,
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

        tmp_lock_path = os.path.join(tmp_dir, "package-lock.json")
        if not os.path.exists(tmp_lock_path):
            raise RuntimeError("Failed to generate production package-lock.json")

        with open(tmp_lock_path, "r", encoding="utf-8") as lf:
            lock_data = json.load(lf)

        root_lock_pkg = lock_data.get("packages", {}).get("", {})
        if root_lock_pkg.get("dependencies") != prod_pkg["dependencies"]:
            raise RuntimeError("Generated package-lock.json root dependencies do not match production package.json")
        if "devDependencies" in root_lock_pkg:
            raise RuntimeError("Generated package-lock.json must not contain devDependencies")

        lock_content = json.dumps(lock_data, indent=2, ensure_ascii=False) + "\n"

    return pkg_content, lock_content

def create_package():
    # Remove old archive if exists
    if os.path.exists(OUTPUT_ZIP_PATH):
        try:
            os.remove(OUTPUT_ZIP_PATH)
        except Exception:
            pass

    added_files = []

    with zipfile.ZipFile(OUTPUT_ZIP_PATH, "w", zipfile.ZIP_DEFLATED) as zf:
        for item in INCLUDE_ITEMS:
            full_path = os.path.join(ROOT_DIR, item)
            if not os.path.exists(full_path):
                raise FileNotFoundError(f"Required item missing for release package: {item}")
            
            if item == "package.json":
                pkg_content, lock_content = build_production_manifest_and_lockfile(full_path)
                zf.writestr("package.json", pkg_content)
                added_files.append({"name": "package.json", "size": len(pkg_content.encode("utf-8"))})
                zf.writestr("package-lock.json", lock_content)
                added_files.append({"name": "package-lock.json", "size": len(lock_content.encode("utf-8"))})
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
