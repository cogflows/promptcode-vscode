import tsParser from "@typescript-eslint/parser";
import typescriptEslint from "@typescript-eslint/eslint-plugin";
import cspRules from './.eslintrc.csp.json' assert { type: 'json' };

// Helper to detect inline event handlers in template literals and strings
const inlineEventHandlerPattern = /\bon[a-z]+\s*=/i;

export default [{
    files: ["**/*.ts"],
}, {
    plugins: {
        "@typescript-eslint": typescriptEslint,
    },

    languageOptions: {
        parser: tsParser,
        ecmaVersion: 2022,
        sourceType: "module",
    },

    rules: {
        "@typescript-eslint/naming-convention": ["warn", {
            selector: "import",
            format: ["camelCase", "PascalCase"],
        }],

        curly: "warn",
        eqeqeq: "warn",
        "no-throw-literal": "warn",
        semi: "warn",
        
        // CSP-related rules for webview files
        ...cspRules.rules,
    },
}, 
// Additional config for webview files with stricter CSP rules
{
    files: ["src/webview/**/*.{ts,js}", "src/webviewProvider.ts", "src/webview/tabs/*.ts"],
    rules: {
        "no-eval": "error",
        "no-implied-eval": "error",
        "no-new-func": "error",
        "no-script-url": "error",
        // Custom rule to check for inline event handlers in strings
        "no-restricted-syntax": [
            "error",
            {
                selector: "TemplateLiteral",
                message: "Check template literals for inline event handlers (onclick, onchange, etc.) which violate CSP"
            }
        ]
    }
}];