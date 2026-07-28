import { createTheme } from '@mui/material/styles';

// A calm, muted palette — soft sage/teal instead of a saturated "brand" blue,
// warm off-white surfaces instead of stark white, gentle corners and shadows
// throughout so the review screen (which someone will sit with for a while,
// going line by line through a receipt) doesn't feel clinical.
export const theme = createTheme({
    palette: {
        mode: 'light',
        primary: { main: '#5B8A72', light: '#7FA98E', dark: '#42654F' },
        secondary: { main: '#8C7AA9' },
        background: { default: '#F5F3EE', paper: '#FCFBF8' },
        text: { primary: '#3A3A35', secondary: '#6B6B63' },
    },
    shape: {
        borderRadius: 10,
    },
    typography: {
        fontFamily: [
            'ui-sans-serif',
            'system-ui',
            '-apple-system',
            'Segoe UI',
            'Roboto',
            'Helvetica Neue',
            'Arial',
            'sans-serif',
        ].join(','),
    },
    components: {
        MuiPaper: {
            styleOverrides: {
                root: { boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
            },
        },
        MuiButton: {
            styleOverrides: {
                root: { textTransform: 'none', fontWeight: 600 },
            },
        },
    },
});
