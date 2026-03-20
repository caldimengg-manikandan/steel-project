import React, { createContext, useContext, useState, useEffect } from 'react';

interface Settings {
    timezone: string;
    dateFormat: string;
    emailNotifications: boolean;
    weeklyReports: boolean;
    darkMode: boolean;
    twoFactor: boolean;
    rfiAutoNumber: boolean;
    activityLogging: boolean;
}

const DEFAULT_SETTINGS: Settings = {
    timezone: 'Asia/Kolkata',
    dateFormat: 'DD/MM/YYYY',
    emailNotifications: true,
    weeklyReports: false,
    darkMode: false,
    twoFactor: false,
    rfiAutoNumber: true,
    activityLogging: true,
};

interface SettingsContextType {
    settings: Settings;
    updateSettings: (newSettings: Partial<Settings>) => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [settings, setSettings] = useState<Settings>(() => {
        const saved = localStorage.getItem('app_settings');
        return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
    });

    useEffect(() => {
        localStorage.setItem('app_settings', JSON.stringify(settings));
        
        // Sync with Theme if darkMode changes
        if (settings.darkMode) {
            document.documentElement.setAttribute('data-theme', 'dark');
        } else {
            document.documentElement.setAttribute('data-theme', 'light');
        }
    }, [settings]);

    const updateSettings = (newSettings: Partial<Settings>) => {
        setSettings(prev => ({ ...prev, ...newSettings }));
    };

    return (
        <SettingsContext.Provider value={{ settings, updateSettings }}>
            {children}
        </SettingsContext.Provider>
    );
};

export const useSettings = () => {
    const context = useContext(SettingsContext);
    if (!context) throw new Error('useSettings must be used within SettingsProvider');
    return context;
};
