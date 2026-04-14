# 🚢 Steel Project Deployment Guide

## 📍 Environment Details
- **Website**: [https://caldimproducts.com/steel](https://caldimproducts.com/steel)
- **API Base**: `/steel/api/`
- **Root Directory**: `/var/www/steel-project`

## 🔄 Automatic Deployment (Recommended)
We have configured GitHub Actions to handle everything. Whenever you want to push an update:

1.  **Commit your changes** on your local machine.
2.  **Push to main**:
    ```bash
    git add .
    git commit -m "Describe your update"
    git push origin main
    ```
3.  **Monitor**: check the **Actions** tab on your GitHub repo. If it turns green, the site is updated.

## 🛠️ Manual Maintenance (If Auto-Deploy Fails)
If the website doesn't update, run these on the VPS:

### Force Pull and Build
```bash
cd /var/www/steel-project
git pull origin main
cd frontend && npm run build
```

### Restart Server
```bash
pm2 restart steel-dms
sudo systemctl restart nginx
```

## 📝 Critical Configs
- **Python**: Ensure `.env` has `PYTHON_BIN=python3`.
- **Database**: `MONGO_URI` must be the Atlas connection string.
- **Nginx**: Configuration is located at `/etc/nginx/sites-available/caldimproducts.conf`.
