/**
 * Base URL + app routes for the blueprint.
 *
 * ┌─ ADAPT THIS TO YOUR APP ──────────────────────────────────────────────────┐
 * │ Set your app's base URL via the URL_BASE env var (see .env.example).       │
 * │ The defaults below are PLACEHOLDERS. The `paths` are EXAMPLE shop routes —  │
 * │ replace them with your app's real routes (the page objects read these keys).│
 * └────────────────────────────────────────────────────────────────────────────┘
 */
const isProduction = process.env.IS_PRODUCTION === 'true';

// ← your app's base URL (set URL_BASE in the environment; these are only fallbacks)
const STAGING_BASE = process.env.URL_BASE ?? 'https://staging.example.com';
const PRODUCTION_BASE = process.env.URL_BASE_PRODUCTION ?? 'https://www.example.com';

export const URLS = {
    isProduction,
    baseUrl: isProduction ? PRODUCTION_BASE : STAGING_BASE,

    // Example shop routes — replace with your app's paths.
    paths: {
        homepage: '/',
        accountSignIn: '/sign_in',
        accountSignUp: '/sign_up',
        accountPortal: '/account/overview',
        accountDesigns: '/account/designs',
        accountUploads: '/account/uploads',
        accountOrderHistory: '/account/orders',
        accountGroupOrders: '/account/group-orders',
        accountStores: '/account/stores'
    }
} as const;
