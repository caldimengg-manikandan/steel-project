import React, { createContext, useContext, useState, useEffect } from 'react';
import { setGlobalDateFormat } from '../utils/dateUtils';

interface Settings {
    timezone: string;
    dateFormat: string;
    emailNotifications: boolean;
    weeklyProgresss: boolean;
    weeklyProgressDay?: number;
    weeklyProgressTime?: string;
    darkMode: boolean;
    twoFactor: boolean;
    rfiAutoNumber: boolean;
    activityLogging: boolean;
    moduleProjects: boolean;
    moduleRfi: boolean;
    moduleReports: boolean;
    logoPath: string;
}

const DEFAULT_SETTINGS: Settings = {
    timezone: 'Asia/Kolkata',
    dateFormat: 'DD/MM/YYYY',
    emailNotifications: true,
    weeklyProgresss: false,
    weeklyProgressDay: 4,
    weeklyProgressTime: '11:45',
    darkMode: false,
    twoFactor: false,
    rfiAutoNumber: true,
    activityLogging: true,
    moduleProjects: true,
    moduleRfi: true,
    moduleReports: true,
    logoPath: '',
};

interface SettingsContextType {
    settings: Settings;
    updateSettings: (newSettings: Partial<Settings>) => void;
    refreshSettings: () => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [settings, setSettings] = useState<Settings>(() => {
        const saved = localStorage.getItem('app_settings');
        return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
    });

const BASE = import.meta.env.VITE_API_URL || '/steel/api';

    const fetchSettings = async () => {
        try {
            const res = await fetch(`${BASE}/settings`, {
                credentials: 'include'
            });
            if (res.ok) {
                const data = await res.json();
                const prefix = BASE.endsWith('/api') ? BASE.slice(0, -4) : BASE;
                setSettings(prev => ({ 
                    ...prev, 
                    ...data,
                    logoPath: data.logoPath ? (data.logoPath.startsWith(prefix) ? data.logoPath : `${prefix}${data.logoPath.startsWith('/') ? '' : '/'}${data.logoPath}`) : ''
                }));
            }
        } catch (err) {
            console.error('Failed to fetch settings:', err);
        }
    };

    useEffect(() => {
        fetchSettings();
    }, []);

    useEffect(() => {
        localStorage.setItem('app_settings', JSON.stringify(settings));
        
        // Sync global date format for all modules
        setGlobalDateFormat(settings.dateFormat);
        
        if (settings.darkMode) {
            document.documentElement.setAttribute('data-theme', 'dark');
        } else {
            document.documentElement.setAttribute('data-theme', 'light');
        }
    }, [settings]);

    const updateSettings = async (newSettings: Partial<Settings>) => {
        setSettings(prev => ({ ...prev, ...newSettings }));

        // Sync to backend
        try {
            const res = await fetch(`${BASE}/settings`, {
                method: 'PATCH',
                headers: { 
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(newSettings),
                credentials: 'include'
            });
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                console.error('Failed to sync settings to backend:', errData.error || res.statusText);
            }
        } catch (err) {
            console.error('Failed to sync settings to backend:', err);
        }
    };

    return (
        <SettingsContext.Provider value={{ settings, updateSettings, refreshSettings: fetchSettings }}>
            {children}
        </SettingsContext.Provider>
    );
};

export const useSettings = () => {
    const context = useContext(SettingsContext);
    if (!context) throw new Error('useSettings must be used within SettingsProvider');
    return context;
};
