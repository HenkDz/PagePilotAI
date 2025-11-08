# PagePilot AI Development Plan

## Phase 0: Conceptualization & Technical Foundation (4-6 Weeks)

The goal here is to establish the core technical stack and prove the feasibility of the key features.

### A. Technology Stack Selection

| Component | Technology | Rationale |
| :--- | :--- | :--- |
| **Extension Core** | TypeScript, React/Svelte (for UI) | Robustness, type safety, modern UI development. |
| **Browser Injection** | Chrome/Firefox Extension Manifest V3 | Standardized way to interact with tabs and content scripts. |
| **AI Backend** | Python (FastAPI/Flask) or Node.js (Express) | Scalability for API calls. |
| **AI Model** | GPT-4o, Claude 3.5, or Fine-tuned smaller model | Start with a leading multimodal model (GPT-4o) for its code quality and visual analysis potential. |
| **Database** | SQLite (for local persistence), or MongoDB/PostgreSQL (for user accounts/script storage) | Simple, efficient storage of user scripts and edit history. |

### B. Core Prototyping (MVP Features)

1. **DOM Selector & Grabber:**
    * Build a lightweight content script that, upon activation, listens for mouse hovers.
    * When the user clicks, it captures the element and generates a high-quality, resilient CSS selector (e.g., using a mix of class names, attributes, and relative positions, similar to how Cypress/Playwright do it).
2. **Persistent Storage Mechanism:**
    * Create a simple architecture for the background service worker to store user scripts locally within the extension's storage, tied to specific URL patterns/domains.
3. **Basic Injection:**
    * Implement the mechanism to inject saved scripts immediately upon the target page loading, mimicking the `@run-at document-start` functionality of Tampermonkey where needed.

---

## Phase 1: Minimum Viable Product (MVP) - The Editing Loop (3-4 Months)

The focus is integrating the visual selection with basic AI generation and live testing.

### A. The Chat Interface & Visual Context

1. **Intuitive Chat UI:** Develop the extension popup/sidebar UI with a chat input area.
2. **Context Passing:** When an element is selected:
    * The generated selector (e.g., `.offer__header > button[mattooltip*="Favorites"]`) is automatically fed into the AI prompt as context.
    * The AI prompt also includes the element's surrounding HTML/DOM structure.

### B. AI Generation Engine (The "Brain")

1. **Initial Prompt Engineering:** Create a detailed system prompt for the chosen LLM (e.g., GPT-4o). This prompt must enforce:
    * Generating **clean, vanilla JavaScript** (not requiring heavy libraries).
    * Generating code that targets the provided selector.
    * **Prioritizing `MutationObserver`** when dealing with lists, feeds, or dynamically loaded content.
    * Using the `localStorage` API when the prompt includes words like "remember," "save," or "permanent."
2. **Code Output Structuring:** The AI must output its generated code in a specific format (e.g., JSON object with `js_code`, `css_code`, and `url_match_pattern`) for the extension to consume easily.

### C. Live Preview and Feedback Loop (The Game Changer)

1. **Temporary Script Injection:** After the AI generates the script, PagePilot must inject this code as a temporary, sandboxed content script, without saving it permanently.
2. **Live Visual Confirmation:** The user sees the change (the new button, the blocked overlay) applied instantly on the live page.
3. **Iterative Refinement:** If the change is imperfect, the user can type "No, put the button on the left side," and the AI regenerates the script using the previous attempt and the new feedback, injecting the new version instantly.

### D. Persistence and Saving

1. **Save Feature:** Implement the "Save Rule" button. This moves the script from the temporary sandbox into the persistent storage engine, making it active for future visits.

---

## Phase 2: Robustness and Advanced Features (4-6 Months)

Focus on handling real-world complexity, maintaining edits, and improving the developer experience.

### A. Advanced DOM Handling and Resilience

1. **Selector Repair:** When a script fails (e.g., due to a website update changing class names), PagePilot detects the runtime error.
    * Implement logic to analyze the error and offer a "Self-Heal" or "Re-Selector" option, where the AI attempts to find the intended element using fuzzy matching or neighboring elements.
2. **Shadow DOM & iFrame Support:** Extend the DOM grabber and script injection to correctly target and interact with elements inside these complex structures.
3. **Waiting for Elements:** The AI script generation logic must incorporate robust element waiting mechanisms (e.g., `requestAnimationFrame` loops or basic promises) to handle elements that load asynchronously.

### B. User Management and Rollback

1. **History Log & Version Control:** Implement a log showing all edits applied to a domain.
    * Allow users to **toggle edits** (disable/enable) and **rollback** to previous saved versions of a script.
2. **Edit Management UI:** A clean interface to review, search, and manage scripts across all modified domains.

### C. AI Sophistication

1. **Custom Data Input:** Allow the user to define simple persistent variables (e.g., "Always hide elements older than 7 days"). The AI must integrate this persistent data into the generated script.
2. **Debugging View:** When a script is active, provide a simplified console view within the PagePilot UI that logs the script's execution status (similar to the debug logs you included in your sample script).

---

## Phase 3: Monetization and Scaling (Ongoing)

Focus on reaching a wider audience and defining the business model.

### A. Security and Audit

1. **Sandboxing:** Ensure all generated and executed scripts run within a secure, isolated context to prevent malicious injection into the host page's environment (standard practice for content scripts).
2. **Transparency:** Clearly display the generated JavaScript code *before* saving it, allowing technical users to review the code being injected.

### B. Business Model

* **Freemium Model:**
  * **Free Tier:** Unlimited basic CSS modifications and a limited number of advanced (JS-based) saved scripts (e.g., 3-5 scripts).
  * **Pro Tier (Subscription):** Unlimited advanced scripts, priority AI generation (faster LLM access), advanced debugging tools, and script synchronization across devices.

### C. Marketing Hook

* Focus marketing on the use cases that are impossible without PagePilot:
  * **"Fixing" broken sites** (e.g., hiding intrusive banners, removing clutter).
  * **Creating permanent quality-of-life features** (like your Admitad blacklist).
  * **Personalized accessibility adjustments.**

---

## Key Technical Requirement: The PagePilot Script Wrapper

To ensure reliability and consistency, every script generated by the AI should be wrapped by a PagePilot execution engine template. This template handles the boring, repetitive parts:

```javascript
// PagePilot Core Wrapper
(function() {
    'use strict';
    
    // 1. Load PagePilot Context (URL, unique identifiers, persistent storage helper)
    const PagePilot = window.PagePilot || { /* utility functions */ }; 
    
    // 2. Load User-Defined Persistence (e.g., the blacklist IDs)
    const persistedData = PagePilot.storage.load(SCRIPT_ID);

    // 3. AI Generated Code Block (This is where the complex JS/CSS functions go)
    // The AI focuses solely on the logic, not the persistence boilerplate.
    
    // 4. Initialization and Observer Setup (Pre-configured for MutationObserver)
    PagePilot.initObserver({
        targetSelector: 'body', // or AI-determined container
        cardSelector: 'admitad-offer',
        callback: function(card) {
            // Call AI-generated processing function (e.g., renderCardState)
        }
    });

})();
```
