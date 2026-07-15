import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import logo from '../assets/logo/caldim_engineering_logo.jpg';

export default function LoginPage() {
    const { login, user } = useAuth();
    const navigate = useNavigate();

    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
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
            const authUser = await login(username, password);
            if (authUser) {
                navigate(FULL_ACCESS_ROLES.includes(authUser.role) ? '/admin' : '/dashboard');
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
                        <div style={{ position: 'relative' }}>
                            <input
                                id="password"
                                type={showPassword ? 'text' : 'password'}
                                className="form-control"
                                placeholder="Enter your password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                autoComplete="current-password"
                                disabled={loading}
                                style={{ paddingRight: '2.5rem' }}
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                tabIndex={-1}
                                title={showPassword ? "Hide password" : "Show password"}
                                style={{
                                    position: 'absolute',
                                    right: '0.75rem',
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    background: 'none',
                                    border: 'none',
                                    cursor: 'pointer',
                                    color: '#6b7280',
                                    padding: '4px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center'
                                }}
                            >
                                {showPassword ? (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                                        <line x1="1" y1="1" x2="23" y2="23"></line>
                                    </svg>
                                ) : (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                        <circle cx="12" cy="12" r="3"></circle>
                                    </svg>
                                )}
                            </button>
                        </div>
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
