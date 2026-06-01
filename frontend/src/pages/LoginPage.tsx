import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import logo from '../assets/logo/caldim_engineering_logo.jpg';

export default function LoginPage() {
    const { login, user } = useAuth();
    const navigate = useNavigate();

    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const FULL_ACCESS_ROLES = ['admin', 'superadmin', 'project_manager', 'team_lead'];
    useEffect(() => {
        if (user) {
            navigate(FULL_ACCESS_ROLES.includes(user.role) ? '/admin' : '/dashboard', { replace: true });
        }
    }, [user, navigate]);

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        setError('');
        if (!username.trim() || !password) {
            setError('Username and password are required.');
            return;
        }
        setLoading(true);
        try {
            const ok = await login(username, password);
            if (ok) {
                const stored = sessionStorage.getItem('sdms_user');
                const u = stored ? JSON.parse(stored) : null;
                navigate(FULL_ACCESS_ROLES.includes(u?.role) ? '/admin' : '/dashboard');
            } else {
                setError('Invalid username or password. Please try again.');
            }
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="login-page">
            {/* Header area */}
            <div className="login-logo-area">
                <div className="login-logo">
                    <img src={logo} alt="CALDIM steel dwf" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                </div>
                <h1 className="login-system-name" style={{ textTransform: 'capitalize' }}>
                    CALDIM steel dwf
                </h1>
                <p className="login-subtitle">Project &amp; Drawing Control Portal</p>
            </div>

            {/* Card */}
            <div className="login-card">
                <div className="login-card-title">Sign In to Your Account</div>

                {error && <div className="login-error">{error}</div>}

                <form onSubmit={handleSubmit} noValidate>
                    <div className="form-group">
                        <label className="form-label required" htmlFor="username">
                            Username
                        </label>
                        <input
                            id="username"
                            type="text"
                            className="form-control"
                            placeholder="Enter your username"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            autoComplete="username"
                            autoFocus
                            disabled={loading}
                        />
                    </div>

                    <div className="form-group">
                        <label className="form-label required" htmlFor="password">
                            Password
                        </label>
                        <input
                            id="password"
                            type="password"
                            className="form-control"
                            placeholder="Enter your password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            autoComplete="current-password"
                            disabled={loading}
                        />
                    </div>

                    <button type="submit" className="login-btn" disabled={loading}>
                        {loading ? 'Authenticating…' : 'Login'}
                    </button>
                </form>
            </div>

            <div className="login-footer">© 2026 CALDIM steel dwf. All rights reserved.</div>
        </div>
    );
}
