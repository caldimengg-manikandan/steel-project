# 🚀 Steel DMS Deployment Documentation

This document explains the technical architecture and automatic deployment process for the Steel Detailing DMS project. It is intended for developers to follow when pushing updates to the system.

---

## 🏗️ Technical Architecture

*   **Frontend**: React (Vite) + TypeScript.
*   **Backend**: Node.js (Express).
*   **Database**: MongoDB (Atlas/Cloud).
*   **File Storage**: Microsoft OneDrive (via Rclone bridge).
*   **Extraction Engine**: Python 3.12 (using PyMuPDF, pdfplumber, and Pydantic).
*   **Deployment**: GitHub Actions (CI/CD) to Ubuntu VPS.

---

## 🚀 How Deployment Works (CI/CD)

The project is configured with **Automatic Deployment**. You do **NOT** need to manually SSH into the server to update the code.

### 1. The Git Workflow
1.  Work on your local branch.
2.  Commit your changes: `git commit -m "Your description"`
3.  Push to GitHub: **`git push origin main`**
4.  Once pushed, **GitHub Actions** immediately starts the deployment process.

### 2. What GitHub Actions Does
The workflow ([.github/workflows/deploy.yml](.github/workflows/deploy.yml)) performs the following steps on the VPS:
*   Pulls the latest code from `main`.
*   Installs Backend dependencies (`npm install`).
*   Restarts the Backend service using **PM2** (`pm2 restart steel-dms`).
*   Builds the Frontend Production Bundle (`npm run build`).

---

## ⚙️ VPS Server Environment Requirements

If you are setting up a new server, ensure the following are installed:

### 🐍 Python Dependencies
The extraction engine requires these libraries on the server:
```bash
pip3 install pydantic pdfplumber pytesseract pdf2image pymupdf --break-system-packages
```

### 🛠️ OS-Level Tools (Ubuntu)
```bash
sudo apt-get update
sudo apt-get install -y tesseract-ocr poppler-utils
```

### 📦 Process Management (PM2)
We use PM2 to keep the backend running 24/7.
*   **Check Status**: `pm2 status`
*   **View Logs**: `pm2 logs steel-dms`
*   **Restart Manually**: `pm2 restart steel-dms`

---

## ☁️ Cloud Storage (OneDrive)
The application uses **Rclone** to sync files to OneDrive. 
*   Ensure Rclone is configured on the VPS with a remote named `onedrive:`.
*   The `.env` file must contain the correct `ONEDRIVE_CLIENT_ID`, `TENANT_ID`, and `CLIENT_SECRET`.

---

## 🚨 Troubleshooting Common Issues

### "Python exit code 1"
**Reason**: Usually a missing Python module or missing `poppler` on the VPS.
**Fix**: Run `pm2 logs steel-dms` to see the traceback. Usually, running `pip3 install <missing-module> --break-system-packages` solves it.

### "CORS Error"
**Reason**: The `CORS_ORIGIN` in the backend `.env` does not match the frontend URL.
**Fix**: Update `CORS_ORIGIN` in `/var/www/steel-project/backend/.env`.

### Deployment Fails on GitHub
**Reason**: Likely your SSH key has expired or the `VPS_HOST` secret was deleted.
**Fix**: Go to GitHub **Settings -> Secrets** and verify `VPS_HOST`, `VPS_USER`, and `VPS_SSH_KEY`.

---

© 2026 Steel Detailing DMS Team.
