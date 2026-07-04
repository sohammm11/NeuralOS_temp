export const tokens = {
    // Colors
    bg: {
        base: '#08090e',
        surface: '#0e0f15',
        elevated: '#13141c',
        overlay: '#1a1b25',
    },
    border: {
        subtle: 'rgba(255,255,255,0.06)',
        default: 'rgba(255,255,255,0.09)',
        strong: 'rgba(255,255,255,0.14)',
    },
    text: {
        primary: '#f0f0f5',
        secondary: '#8b8fa8',
        tertiary: '#55596e',
        disabled: '#3a3d50',
    },
    accent: {
        purple: '#7c3aed',
        purpleHover: '#6d28d9',
        purpleSubtle: 'rgba(124,58,237,0.12)',
        purpleBorder: 'rgba(124,58,237,0.3)',
        green: '#10b981',
        greenSubtle: 'rgba(16,185,129,0.12)',
        amber: '#f59e0b',
        amberSubtle: 'rgba(245,158,11,0.10)',
        red: '#ef4444',
        redSubtle: 'rgba(239,68,68,0.10)',
    },
    // Typography
    font: {
        xs: '11px',
        sm: '12px',
        base: '13px',
        md: '14px',
        lg: '15px',
        xl: '18px',
    },
    weight: {
        normal: '400',
        medium: '500',
        semibold: '600',
    },
    // Spacing (4px grid)
    space: {
        1: '4px',
        2: '8px',
        3: '12px',
        4: '16px',
        5: '20px',
        6: '24px',
        8: '32px',
        10: '40px',
    },
    // Radius
    radius: {
        sm: '4px',
        md: '6px',
        lg: '8px',
        xl: '12px',
    }
}

// Button styles
export const btn = {
    primary: {
        padding: '7px 14px',
        background: '#7c3aed',
        border: 'none',
        borderRadius: '6px',
        color: '#ffffff',
        fontSize: '12px',
        fontWeight: '500',
        cursor: 'pointer',
        transition: 'background 0.15s',
    },
    secondary: {
        padding: '7px 14px',
        background: 'transparent',
        border: '1px solid rgba(255,255,255,0.09)',
        borderRadius: '6px',
        color: '#8b8fa8',
        fontSize: '12px',
        fontWeight: '400',
        cursor: 'pointer',
    },
    danger: {
        padding: '7px 14px',
        background: 'transparent',
        border: '1px solid rgba(239,68,68,0.3)',
        borderRadius: '6px',
        color: '#ef4444',
        fontSize: '12px',
        cursor: 'pointer',
    },
    ghost: {
        padding: '7px 14px',
        background: 'transparent',
        border: 'none',
        borderRadius: '6px',
        color: '#8b8fa8',
        fontSize: '12px',
        cursor: 'pointer',
    }
}

// Card style
export const card = {
    default: {
        background: '#0e0f15',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: '8px',
        padding: '20px',
    },
    elevated: {
        background: '#13141c',
        border: '1px solid rgba(255,255,255,0.09)',
        borderRadius: '8px',
        padding: '20px',
    }
}