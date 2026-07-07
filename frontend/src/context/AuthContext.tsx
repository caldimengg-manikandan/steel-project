import {
    createContext,
    useContext,
    useState,
    useCallback,
    useEffect,
    type ReactNode,
} from 'react';
import type { AuthUser } from '../types';

interface AuthContextValue {
    user: AuthUser | null;
    login: (username: string, password: string) => Promise<boolean>;
    logout: () => void;
    isAuthenticated: boolean;
    isLoading: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<AuthUser | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const checkAuth = async () => {
            const BASE = import.meta.env.VITE_API_URL || '/steel/api';
            try {
                const res = await fetch(`${BASE}/auth/me`, {
                    credentials: 'include'
                });
                if (res.ok) {
                    const data = await res.json();
                    setUser(data.user);
                } else {
                    setUser(null);
                }
            } catch {
                setUser(null);
            } finally {
                setIsLoading(false);
            }
        };
        checkAuth();
    }, []);

    const login = useCallback(async (username: string, password: string): Promise<boolean> => {
        const BASE = import.meta.env.VITE_API_URL || '/steel/api';

        try {
            // First, try Admin login
            let res = await fetch(`${BASE}/auth/admin/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ username, password }),
            });

            if (!res.ok) {
                // Try User login if admin failed
                res = await fetch(`${BASE}/auth/user/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ username, password }),
                });
            }

            if (res.ok) {
                const data = await res.json();
                const authUser: AuthUser = {
                    id: data.user.id || data.user._id,
                    username: data.user.username,
                    email: data.user.email,
                    role: data.user.role,
                    adminId: data.user.adminId,
                };
                setUser(authUser);
                return true;
            }
        } catch (err) {
            console.error('[Auth] Real API login failed:', err);
        }

        return false;
    }, []);

    const logout = useCallback(async () => {
        const BASE = import.meta.env.VITE_API_URL || '/steel/api';
        try {
            await fetch(`${BASE}/auth/logout`, {
                method: 'POST',
                credentials: 'include'
            });
        } catch (e) {
            console.error('Logout failed:', e);
        }
        setUser(null);
    }, []);

    return (
        <AuthContext.Provider value={{ user, login, logout, isAuthenticated: !!user, isLoading }}>
            {isLoading ? <div>Loading...</div> : children}
        </AuthContext.Provider>
    );
}

export function useAuth(): AuthContextValue {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
    return ctx;
}
