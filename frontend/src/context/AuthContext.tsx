import {
    createContext,
    useContext,
    useState,
    useCallback,
    type ReactNode,
} from 'react';
import type { AuthUser } from '../types';

interface AuthContextValue {
    user: AuthUser | null;
    login: (username: string, password: string) => Promise<boolean>;
    logout: () => void;
    isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Mock credential database — replace with real API calls
// Mock credential database — replaced with real API calls


export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<AuthUser | null>(() => {
        try {
            const stored = sessionStorage.getItem('sdms_user');
            return stored ? JSON.parse(stored) : null;
        } catch {
            return null;
        }
    });

    const login = useCallback(async (username: string, password: string): Promise<boolean> => {
        const BASE = import.meta.env.VITE_API_URL || '/api';

        try {
            // First, try Admin login
            let res = await fetch(`${BASE}/auth/admin/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
            });

            if (!res.ok) {
                // Try User login if admin failed
                res = await fetch(`${BASE}/auth/user/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
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
                    token: data.token,
                };
                setUser(authUser);
                sessionStorage.setItem('sdms_user', JSON.stringify(authUser));
                return true;
            }
        } catch (err) {
            console.error('[Auth] Real API login failed:', err);
        }

        return false;
    }, []);

    const logout = useCallback(() => {
        setUser(null);
        sessionStorage.removeItem('sdms_user');
    }, []);

    return (
        <AuthContext.Provider value={{ user, login, logout, isAuthenticated: !!user }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth(): AuthContextValue {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
    return ctx;
}
