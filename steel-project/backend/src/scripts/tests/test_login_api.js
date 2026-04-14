async function testLogin() {
    try {
        const response = await fetch('http://localhost:5000/api/auth/admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: 'admin1',
                password: 'Admin1@2026'
            })
        });
        const data = await response.json();
        if (response.ok) {
            console.log('Login successful:', data.user.username);
        } else {
            console.error('Login failed:', data);
        }
    } catch (error) {
        console.error('Fetch error:', error.message);
    }
}

testLogin();
