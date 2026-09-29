import paramiko

host = '187.127.135.34'
user = 'caldim'
password = 'Caldim@2026'

print(f"Connecting to {host} as {user}...")

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

try:
    ssh.connect(host, username=user, password=password)
    
    sftp = ssh.open_sftp()
    sftp.put(r'c:\steel-project(2)\steel-project\steel-project\backend\src\controllers\fileGatewayController.js', '/var/www/steel-project/backend/src/controllers/fileGatewayController.js')
    sftp.close()
    
    commands = """
    pm2 restart steel-dms
    """
    
    stdin, stdout, stderr = ssh.exec_command(commands)
    exit_status = stdout.channel.recv_exit_status()
    print("Output:\n", stdout.read().decode('utf-8', errors='replace'))
    
except Exception as e:
    print(f"Failed: {e}")
finally:
    ssh.close()
