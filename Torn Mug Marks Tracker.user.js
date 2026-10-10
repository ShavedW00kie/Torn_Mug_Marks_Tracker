// ==UserScript==
// @name         Torn Mug Marks Tracker
// @namespace    https://github.com/ShavedW00kie/
// @version      1.0.0
// @description  Manual Torn target scouting and Google Sheets mug logging
// @author       ShavedW00kie (Torn: ThaWookie [2954173] )
// @license      BSD-3-Clause
// @match        https://www.torn.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @run-at       document-end
// ==/UserScript==

/**
 * File: userscript-debugger-module.js
 * Version: 1.0.2
 * Advanced Modular Userscript Debugger Engine
 * Author: Github.com/ShavedW00kie/
 * Optimized for Desktop PC, Mobile Browsers, and TornPDA Native WebViews
 *
 * License: BSD-3-Clause
 *
 * Copyright (c) 2026 ShavedW00kie
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice,
 *    this list of conditions and the following disclaimer.
 *
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the documentation
 *    and/or other materials provided with the distribution.
 *
 * 3. Neither the name of the copyright holder nor the names of its
 *    contributors may be used to endorse or promote products derived from
 *    this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
 * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * initializeModularDebugger()
 *
 * Creates an isolated debugger instance for a userscript.
 *
 * Public API:
 *   MyDebug.log(message)
 *   MyDebug.info(message)
 *   MyDebug.warn(message)
 *   MyDebug.error(message)
 *   MyDebug.copy(buttonElement)
 *   MyDebug.toggleView()
 *   MyDebug.clear()
 *
 * Example:
 *
 * const MyDebug = initializeModularDebugger(GM_info.script.name);
 *
 * MyDebug.log("Script initialized.");
 * MyDebug.error("Something went wrong.");
 *
 * // Settings UI:
 * debugButton.onclick = () => MyDebug.toggleView();
 * copyButton.onclick = function () {
 *     MyDebug.copy(this);
 * };
 */
function initializeModularDebugger(scriptNamespace = "App") {
    /* strict mode inherited from containing userscript where applicable */

    /* ============================================================
     * 1. INSTANCE ISOLATION
     * ============================================================ */

    const randomSuffix = (() => {
        try {
            if (
                typeof crypto !== "undefined" &&
                typeof crypto.randomUUID === "function"
            ) {
                return crypto.randomUUID().replace(/-/g, "");
            }
        } catch (_) {
            // Fall through to compatibility fallback.
        }

        return Math.random()
            .toString(36)
            .slice(2, 11) +
            Date.now().toString(36);
    })();

    const prefix = `us-debug-${randomSuffix}`;

    const CONTAINER_ID = `${prefix}-box`;
    const LOG_AREA_ID = `${prefix}-logs`;

    /* ============================================================
     * 2. MEMORY LIMITS
     * ============================================================ */

    /*
     * Clipboard-safe baseline.
     *
     * JavaScript strings are UTF-16. This limit is intentionally
     * character-based rather than byte-based because browser clipboard
     * implementations differ in their handling of Unicode.
     */
    const CLIPBOARD_MAX_CHARS = 10 * 1024 * 1024;

    /*
     * Reserve approximately 900 KiB of headroom.
     *
     * Effective maximum retained log buffer:
     * approximately 9.1 million characters.
     */
    const BUFFER_REDUCTION_MARGIN = 900 * 1024;

    const MAX_LOG_STRING_LENGTH =
        CLIPBOARD_MAX_CHARS - BUFFER_REDUCTION_MARGIN;

    /*
     * Never allow one pathological message to exceed the entire
     * configured buffer.
     */
    const MAX_SINGLE_LOG_LENGTH = MAX_LOG_STRING_LENGTH;

    /* ============================================================
     * 3. INTERNAL STATE
     * ============================================================ */

    const state = {
        logs: [],
        currentBufferLength: 0,

        domElements: {
            container: null,
            logArea: null
        },

        observer: null,
        observerAttached: false,

        destroyed: false
    };

    /* ============================================================
     * 4. DOM UTILITIES
     * ============================================================ */

    function getDocumentBody() {
        return document && document.body
            ? document.body
            : null;
    }

    function getExistingContainer() {
        return document.getElementById(CONTAINER_ID);
    }

    function isContainerAttached() {
        return Boolean(
            state.domElements.container &&
            state.domElements.container.isConnected
        );
    }

    function ensureObserver() {
        if (
            state.observerAttached ||
            typeof MutationObserver === "undefined"
        ) {
            return;
        }

        const body = getDocumentBody();

        if (!body) {
            return;
        }

        state.observer = new MutationObserver(() => {
            /*
             * Do not continuously recreate the UI.
             *
             * If the user intentionally hides the debugger, the
             * element still exists and therefore remains untouched.
             *
             * If Torn or another page lifecycle removes the element,
             * the internal references are invalidated so the next
             * toggleView() can recreate it safely.
             */
            if (
                state.domElements.container &&
                !state.domElements.container.isConnected
            ) {
                state.domElements.container = null;
                state.domElements.logArea = null;
            }
        });

        state.observer.observe(body, {
            childList: true,
            subtree: true
        });

        state.observerAttached = true;
    }

    function appendToBody(element) {
        const body = getDocumentBody();

        if (!body || !element) {
            return false;
        }

        body.appendChild(element);
        return true;
    }

    /* ============================================================
     * 5. SAFE SERIALIZATION
     * ============================================================ */

    function safeSerialize(value) {
        /*
         * Fast path for strings.
         */
        if (typeof value === "string") {
            return value;
        }

        /*
         * Primitive values.
         */
        if (
            value === null ||
            typeof value === "number" ||
            typeof value === "boolean" ||
            typeof value === "bigint"
        ) {
            try {
                return String(value);
            } catch (_) {
                return "[Unserializable Primitive]";
            }
        }

        if (typeof value === "undefined") {
            return "undefined";
        }

        if (typeof value === "symbol") {
            try {
                return value.toString();
            } catch (_) {
                return "[Symbol]";
            }
        }

        if (typeof value === "function") {
            try {
                return `[Function: ${value.name || "anonymous"}]`;
            } catch (_) {
                return "[Function]";
            }
        }

        /*
         * Error objects deserve special handling because
         * JSON.stringify(new Error()) normally returns "{}".
         */
        if (value instanceof Error) {
            const errorObject = {
                name: value.name,
                message: value.message,
                stack: value.stack
            };

            try {
                return JSON.stringify(errorObject);
            } catch (_) {
                return `${value.name || "Error"}: ${value.message || ""}`;
            }
        }

        /*
         * General objects.
         *
         * WeakSet prevents circular-reference crashes.
         */
        try {
            const seen = new WeakSet();

            const serialized = JSON.stringify(
                value,
                (key, nestedValue) => {
                    if (typeof nestedValue === "bigint") {
                        return `${nestedValue}n`;
                    }

                    if (typeof nestedValue === "undefined") {
                        return "[undefined]";
                    }

                    if (
                        typeof nestedValue === "object" &&
                        nestedValue !== null
                    ) {
                        if (seen.has(nestedValue)) {
                            return "[Circular]";
                        }

                        seen.add(nestedValue);
                    }

                    return nestedValue;
                }
            );

            if (typeof serialized === "string") {
                return serialized;
            }
        } catch (_) {
            // Fall through to String() fallback.
        }

        try {
            return String(value);
        } catch (_) {
            return "[Serialization Error]";
        }
    }

    /* ============================================================
     * 6. LOG ENTRY MANAGEMENT
     * ============================================================ */

    function truncateLogEntry(entry) {
        if (entry.length <= MAX_SINGLE_LOG_LENGTH) {
            return entry;
        }

        return (
            entry.slice(0, MAX_SINGLE_LOG_LENGTH - 40) +
            "\n...[LOG ENTRY TRUNCATED]..."
        );
    }

    function pruneBufferForEntry(entryLength) {
        while (
            state.logs.length > 0 &&
            state.currentBufferLength + entryLength >
                MAX_LOG_STRING_LENGTH
        ) {
            const removed = state.logs.shift();

            if (typeof removed === "string") {
                state.currentBufferLength -= removed.length + 1;
            }
        }

        /*
         * Defensive correction against any impossible negative state
         * caused by external mutation or future implementation changes.
         */
        if (state.currentBufferLength < 0) {
            state.currentBufferLength = 0;
        }
    }

    function renderLogs() {
        const logArea = state.domElements.logArea;

        if (!logArea || !logArea.isConnected) {
            return;
        }

        logArea.textContent = state.logs.join("\n");

        const container = state.domElements.container;

        if (container && container.isConnected) {
            container.scrollTop = container.scrollHeight;
        }
    }

    /* ============================================================
     * 7. PUBLIC LOGGING ENGINE
     * ============================================================ */

    function log(message, level = "INFO") {
        const time = new Date().toLocaleTimeString();

        let cleanMessage = safeSerialize(message);

        cleanMessage = truncateLogEntry(cleanMessage);

        const normalizedLevel =
            typeof level === "string"
                ? level.toUpperCase()
                : "INFO";

        let entry =
            `[${time}] [${normalizedLevel}] ${cleanMessage}`;

        entry = truncateLogEntry(entry);

        const entryLength = entry.length + 1;

        /*
         * If the entry is somehow still too large, do not store it.
         */
        if (entry.length > MAX_LOG_STRING_LENGTH) {
            return;
        }

        pruneBufferForEntry(entryLength);

        state.logs.push(entry);
        state.currentBufferLength += entryLength;

        renderLogs();
    }

    function info(message) {
        log(message, "INFO");
    }

    function warn(message) {
        log(message, "WARN");
    }

    function error(message) {
        log(message, "ERROR");
    }

    /* ============================================================
     * 8. CLEAR LOGS
     * ============================================================ */

    function clearLogs() {
        state.logs.length = 0;
        state.currentBufferLength = 0;

        renderLogs();
    }

    /* ============================================================
     * 9. COPY STATUS UI
     * ============================================================ */

    function setButtonStatus(button, text, statusClass = "") {
        if (!button) {
            return;
        }

        button.textContent = text;

        if (statusClass) {
            button.dataset.debugStatus = statusClass;
        } else {
            delete button.dataset.debugStatus;
        }
    }

    /*
     * Restore button state without using a timer.
     *
     * CSS animation provides the delay and animationend restores
     * the original label. This avoids setTimeout-based state handling.
     */
    function prepareStatusAnimation(button) {
        if (!button) {
            return;
        }

        if (button.dataset.debugStatusListener === "1") {
            return;
        }

        button.dataset.debugStatusListener = "1";

        button.addEventListener("animationend", (event) => {
            if (event.animationName !== "us-debug-status-reset") {
                return;
            }

            const originalText =
                button.dataset.debugOriginalText || "Copy Logs";

            button.textContent = originalText;

            delete button.dataset.debugStatus;
        });
    }

    function showCopyStatus(button, text, originalText = null) {
        if (!button) {
            return;
        }

        prepareStatusAnimation(button);

        if (originalText) {
            button.dataset.debugOriginalText = originalText;
        } else if (!button.dataset.debugOriginalText) {
            button.dataset.debugOriginalText =
                button.textContent || "Copy Logs";
        }

        button.classList.remove("us-debug-status-reset");

        /*
         * Force animation restart without a timing delay.
         */
        void button.offsetWidth;

        button.textContent = text;
        button.classList.add("us-debug-status-reset");
    }

    /* ============================================================
     * 10. CLIPBOARD ENGINE
     * ============================================================ */

    async function copyLogs(buttonElement = null) {
        const payload = state.logs.join("\n");

        if (!payload) {
            showCopyStatus(buttonElement, "Empty!");
            return false;
        }

        /*
         * Preferred modern clipboard implementation.
         */
        if (
            typeof navigator !== "undefined" &&
            navigator.clipboard &&
            typeof navigator.clipboard.writeText === "function"
        ) {
            try {
                await navigator.clipboard.writeText(payload);

                showCopyStatus(buttonElement, "Copied!");

                return true;
            } catch (_) {
                /*
                 * Continue into compatibility fallback.
                 */
            }
        }

        /*
         * Legacy compatibility path.
         *
         * Still useful for restricted userscript environments,
         * embedded WebViews, and older browser implementations.
         */
        const success = handleCopyFallback(payload);

        if (success) {
            showCopyStatus(buttonElement, "Copied!");
            return true;
        }

        showCopyStatus(buttonElement, "Failed!");
        return false;
    }

    function handleCopyFallback(textData) {
        try {
            const body = getDocumentBody();

            if (!body) {
                return false;
            }

            const textarea = document.createElement("textarea");

            textarea.value = textData;

            textarea.setAttribute("readonly", "");
            textarea.style.position = "fixed";
            textarea.style.top = "0";
            textarea.style.left = "0";
            textarea.style.width = "1px";
            textarea.style.height = "1px";
            textarea.style.padding = "0";
            textarea.style.border = "0";
            textarea.style.outline = "0";
            textarea.style.boxShadow = "none";
            textarea.style.background = "transparent";
            textarea.style.opacity = "0";

            body.appendChild(textarea);

            textarea.focus();
            textarea.select();

            /*
             * iOS/WebView compatibility.
             */
            try {
                textarea.setSelectionRange(
                    0,
                    textarea.value.length
                );
            } catch (_) {
                // Not supported in every environment.
            }

            let success = false;

            try {
                success = document.execCommand("copy");
            } catch (_) {
                success = false;
            }

            textarea.remove();

            return Boolean(success);
        } catch (copyError) {
            /*
             * Logging the failure is intentionally done without
             * console.error so the module never reintroduces the
             * native console logging that the architecture is
             * designed to replace.
             */
            error({
                operation: "clipboard-fallback",
                message:
                    copyError && copyError.message
                        ? copyError.message
                        : String(copyError)
            });

            return false;
        }
    }

    /* ============================================================
     * 11. DEBUGGER UI
     * ============================================================ */

    function injectStyles() {
        if (document.getElementById(`${prefix}-style`)) {
            return;
        }

        const styleNode = document.createElement("style");

        styleNode.id = `${prefix}-style`;

        styleNode.textContent = `
            @keyframes us-debug-status-reset {
                from {
                    opacity: 0.75;
                }
                to {
                    opacity: 1;
                }
            }

            #${CONTAINER_ID} .us-debug-status-reset {
                animation: us-debug-status-reset 1.5s ease-in-out 1;
            }
        `;

        const head = document.head;

        if (head) {
            head.appendChild(styleNode);
        } else {
            const body = getDocumentBody();

            if (body) {
                body.appendChild(styleNode);
            }
        }
    }

    function createDebuggerContainer() {
        const body = getDocumentBody();

        if (!body) {
            return null;
        }

        const existingContainer = getExistingContainer();

        if (existingContainer) {
            state.domElements.container = existingContainer;

            const existingLogArea =
                document.getElementById(LOG_AREA_ID);

            state.domElements.logArea = existingLogArea;

            renderLogs();

            return existingContainer;
        }

        injectStyles();

        const container = document.createElement("div");

        container.id = CONTAINER_ID;

        container.style.cssText = [
            "position:fixed",
            "bottom:12px",
            "right:12px",
            "width:calc(100% - 24px)",
            "max-width:420px",
            "height:280px",
            "background:#181818",
            "color:#00ff66",
            "font-family:monospace",
            "font-size:11px",
            "padding:12px",
            "z-index:2147483647",
            "border:1px solid #00ff66",
            "overflow-y:auto",
            "overflow-x:hidden",
            "box-shadow:0 4px 20px rgba(0,0,0,0.7)",
            "border-radius:4px",
            "box-sizing:border-box",
            "touch-action:pan-y"
        ].join(";");

        const header = document.createElement("div");

        header.style.cssText = [
            "display:flex",
            "justify-content:space-between",
            "align-items:center",
            "gap:8px",
            "margin-bottom:8px",
            "border-bottom:1px solid #333",
            "padding-bottom:5px",
            "user-select:none"
        ].join(";");

        const title = document.createElement("span");

        title.textContent =
            `DEBUG LOG [${String(scriptNamespace)}]`;

        title.style.cssText = [
            "font-weight:bold",
            "letter-spacing:0.5px",
            "overflow:hidden",
            "text-overflow:ellipsis",
            "white-space:nowrap"
        ].join(";");

        const buttonGroup = document.createElement("div");

        buttonGroup.style.cssText = [
            "display:flex",
            "gap:6px",
            "flex-shrink:0"
        ].join(";");

        const copyBtn = document.createElement("button");

        copyBtn.type = "button";
        copyBtn.textContent = "Copy";
        copyBtn.style.cssText = [
            "background:#2a2a2a",
            "color:#fff",
            "border:1px solid #444",
            "cursor:pointer",
            "padding:5px 8px",
            "font-size:10px",
            "border-radius:3px",
            "touch-action:manipulation"
        ].join(";");

        copyBtn.addEventListener("click", () => {
            void copyLogs(copyBtn);
        });

        const clearBtn = document.createElement("button");

        clearBtn.type = "button";
        clearBtn.textContent = "Clear";
        clearBtn.style.cssText = [
            "background:#2a2a2a",
            "color:#fff",
            "border:1px solid #444",
            "cursor:pointer",
            "padding:5px 8px",
            "font-size:10px",
            "border-radius:3px",
            "touch-action:manipulation"
        ].join(";");

        clearBtn.addEventListener("click", () => {
            clearLogs();
        });

        const closeBtn = document.createElement("button");

        closeBtn.type = "button";
        closeBtn.textContent = "Hide";
        closeBtn.style.cssText = [
            "background:#a82020",
            "color:#fff",
            "border:none",
            "cursor:pointer",
            "padding:5px 8px",
            "font-size:10px",
            "border-radius:3px",
            "touch-action:manipulation"
        ].join(";");

        closeBtn.addEventListener("click", () => {
            container.style.display = "none";
        });

        const logArea = document.createElement("div");

        logArea.id = LOG_AREA_ID;

        logArea.style.cssText = [
            "white-space:pre-wrap",
            "overflow-wrap:anywhere",
            "word-break:break-word",
            "font-family:monospace",
            "line-height:1.4",
            "user-select:text"
        ].join(";");

        buttonGroup.appendChild(copyBtn);
        buttonGroup.appendChild(clearBtn);
        buttonGroup.appendChild(closeBtn);

        header.appendChild(title);
        header.appendChild(buttonGroup);

        container.appendChild(header);
        container.appendChild(logArea);

        if (!appendToBody(container)) {
            return null;
        }

        state.domElements.container = container;
        state.domElements.logArea = logArea;

        renderLogs();

        return container;
    }

    /* ============================================================
     * 12. VIEW TOGGLE
     * ============================================================ */

    function toggleConsoleView() {
        const existingContainer = getExistingContainer();

        if (existingContainer) {
            state.domElements.container = existingContainer;

            const existingLogArea =
                document.getElementById(LOG_AREA_ID);

            state.domElements.logArea = existingLogArea;

            const isHidden =
                existingContainer.style.display === "none";

            existingContainer.style.display =
                isHidden ? "block" : "none";

            if (isHidden) {
                renderLogs();
            }

            ensureObserver();

            return;
        }

        const container = createDebuggerContainer();

        if (container) {
            container.style.display = "block";
            renderLogs();
        }

        ensureObserver();
    }

    /* ============================================================
     * 13. INITIALIZATION
     * ============================================================ */

    function initialize() {
        if (state.destroyed) {
            return;
        }

        ensureObserver();

        /*
         * We intentionally do not use setTimeout/setInterval to wait
         * for Torn's DOM.
         *
         * If body already exists, initialization can proceed.
         * Otherwise DOMContentLoaded provides the one-time lifecycle
         * event required for early execution contexts.
         */
        if (getDocumentBody()) {
            return;
        }

        if (document.readyState === "loading") {
            document.addEventListener(
                "DOMContentLoaded",
                initialize,
                { once: true }
            );
        }
    }

    initialize();

    /* ============================================================
     * 14. PUBLIC API
     * ============================================================ */

    return Object.freeze({
        /*
         * Primary logging API.
         */
        log,

        /*
         * Structured convenience methods.
         */
        info,
        warn,
        error,

        /*
         * REQUIRED BY THE USERSCRIPT ARCHITECTURE.
         *
         * Future settings UI:
         * copyButton.onclick = function () {
         *     MyDebug.copy(this);
         * };
         */
        copy: copyLogs,

        /*
         * Debugger overlay.
         */
        toggleView: toggleConsoleView,

        /*
         * Optional maintenance operation.
         */
        clear: clearLogs
    });
}
/*
 * Donation UI Module
 * Version 1.4
 *
 * Reusable support/donation UI for Torn.com userscripts.
 *
 * Features:
 *   - Animated Buy Me a Coffee button
 *   - Animated coffee cup with squash-and-stretch movement
 *   - Animated steam
 *   - Animated coffee fill
 *   - Hover-to-fill coffee effect
 *   - Periodic diagonal button gleam
 *   - Animated liquid-style label transition
 *   - Torn Xanax-tip button
 *   - MutationObserver persistence against Torn/React DOM changes
 *   - TornPDA/mobile-compatible DOM implementation
 *   - Reduced-motion accessibility support
 *
 * License: BSD-3-Clause
 *
 * Copyright (c) 2026 ShavedW00kie
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice,
 *    this list of conditions and the following disclaimer.
 *
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * 3. Neither the name of the copyright holder nor the names of its
 *    contributors may be used to endorse or promote products derived from
 *    this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

(function () {
    "use strict";

    /* ============================================================
     * CONFIGURATION
     * ============================================================ */

    const DEFAULT_CONFIG = Object.freeze({
        bmcId: "bittick1c",
        tornUserId: "2954173",

        containerId: "thawookie-support-module",
        styleId: "thawookie-support-module-style"
    });

    /*
     * Unique counter used for SVG clipPath IDs.
     *
     * SVG IDs are document-global. If multiple instances of this
     * module are ever created, sharing a clipPath ID can cause one
     * SVG to reference another SVG's clipping path.
     */
    let coffeeInstanceCount = 0;

    /* ============================================================
     * SUPPORT MODULE
     * ============================================================ */

    class SupportModule {
        constructor(config = {}) {
            this.config = {
                ...DEFAULT_CONFIG,
                ...config
            };

            this.observer = null;
            this.observerAttached = false;
            this.isInjecting = false;
            this.destroyed = false;

            this.init();
        }

        /* ========================================================
         * INITIALIZATION
         * ======================================================== */

        init() {
            if (this.destroyed) {
                return;
            }

            if (!this.getBody()) {
                if (document.readyState === "loading") {
                    document.addEventListener(
                        "DOMContentLoaded",
                        () => this.init(),
                        { once: true }
                    );
                }

                return;
            }

            this.injectStyles();
            this.injectUI();
            this.attachObserver();
        }

        /* ========================================================
         * DOM HELPERS
         * ======================================================== */

        getBody() {
            return document.body || null;
        }

        getContainer() {
            return document.getElementById(
                this.config.containerId
            );
        }

        isContainerConnected() {
            const container = this.getContainer();

            return Boolean(
                container &&
                container.isConnected
            );
        }

        /* ========================================================
         * STYLE INJECTION
         * ======================================================== */

        injectStyles() {
            if (this.destroyed) {
                return;
            }

            if (document.getElementById(this.config.styleId)) {
                return;
            }

            const styles = `
                /* =================================================
                 * DONATION CONTAINER
                 * ================================================= */

                #${this.config.containerId} {
                    position: fixed;
                    bottom: 20px;
                    right: 20px;
                    z-index: 2147483640;
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                    font-family: Arial, sans-serif;
                    box-sizing: border-box;
                    touch-action: manipulation;
                }

                /* =================================================
                 * GENERIC SUPPORT BUTTON
                 * ================================================= */

                #${this.config.containerId} .tw-support-btn {
                    box-sizing: border-box;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    min-height: 40px;
                    padding: 10px 15px;
                    border-radius: 8px;
                    font-size: 13px;
                    font-weight: bold;
                    line-height: 1.2;
                    text-align: center;
                    text-decoration: none !important;
                    cursor: pointer;
                    user-select: none;
                    -webkit-tap-highlight-color: transparent;
                    touch-action: manipulation;
                }

                #${this.config.containerId} .tw-support-btn:focus-visible {
                    outline: 2px solid #ffffff;
                    outline-offset: 2px;
                }

                /* =================================================
                 * BUY ME A COFFEE BUTTON
                 *
                 * Visual design ported from the supplied animated
                 * coffee-button implementation:
                 *
                 *   #FFDD00 yellow
                 *   black foreground
                 *   6px radius
                 *   6px 12px compact padding
                 *   11px / 600 typography
                 *   animated glare
                 *   animated cup
                 * ================================================= */

                #${this.config.containerId} .tw-bmc {
                    position: relative;
                    overflow: hidden;
                    isolation: isolate;

                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 6px;

                    width: 100%;
                    min-width: 170px;
                    min-height: 40px;

                    padding: 6px 12px;

                    background: #FFDD00;
                    color: #000000 !important;

                    border: 1px solid #FFDD00;
                    border-radius: 6px;

                    font-size: 11px;
                    font-weight: 600;
                    line-height: 1.2;

                    text-decoration: none !important;

                    box-sizing: border-box;

                    transition:
                        opacity 0.15s ease,
                        transform 0.15s ease;
                }

                /*
                 * Keep all actual button contents above the
                 * animated specular highlight.
                 */
                #${this.config.containerId} .tw-bmc > * {
                    position: relative;
                    z-index: 1;
                }

                /*
                 * Subtle interaction feedback.
                 *
                 * Hover is deliberately opacity-based rather than
                 * relying on desktop-only behavior for functionality.
                 * The button remains fully usable through touch.
                 */
                #${this.config.containerId} .tw-bmc:hover {
                    opacity: 0.9;
                }

                #${this.config.containerId} .tw-bmc:active {
                    transform: scale(0.97);
                }

                /* =================================================
                 * COFFEE CUP — SQUASH & STRETCH
                 * ================================================= */

                @keyframes tw-coffee-cup-hop {
                    0% {
                        transform:
                            translateY(0)
                            scale(1, 1);
                    }

                    18% {
                        transform:
                            translateY(0.5px)
                            scale(1.08, 0.9);
                    }

                    32% {
                        transform:
                            translateY(-2px)
                            scale(0.94, 1.08);
                    }

                    50% {
                        transform:
                            translateY(-3px)
                            scale(1, 1);
                    }

                    68% {
                        transform:
                            translateY(0)
                            scale(1.1, 0.88);
                    }

                    84% {
                        transform:
                            translateY(0)
                            scale(0.97, 1.03);
                    }

                    100% {
                        transform:
                            translateY(0)
                            scale(1, 1);
                    }
                }

                #${this.config.containerId} .tw-coffee-cup {
                    position: relative;
                    display: inline-flex;
                    flex-shrink: 0;

                    transform-origin: 50% 100%;

                    animation:
                        tw-coffee-cup-hop
                        2.4s
                        cubic-bezier(0.4, 0, 0.5, 1)
                        infinite;
                }

                /*
                 * Cup outline remains above the steam.
                 */
                #${this.config.containerId} .tw-coffee-cup > svg {
                    position: relative;
                    z-index: 1;
                    display: block;
                }

                /* =================================================
                 * STEAM
                 * ================================================= */

                #${this.config.containerId} .tw-coffee-cup::before,
                #${this.config.containerId} .tw-coffee-cup::after {
                    content: "";

                    position: absolute;

                    bottom: 74%;

                    width: 2px;
                    height: 4px;

                    border-radius: 999px;

                    background:
                        linear-gradient(
                            to top,
                            rgba(90, 58, 36, 0.5),
                            rgba(90, 58, 36, 0)
                        );

                    opacity: 0;

                    pointer-events: none;

                    will-change:
                        transform,
                        opacity;
                }

                #${this.config.containerId} .tw-coffee-cup::before {
                    left: 27%;

                    animation:
                        tw-coffee-steam
                        2.8s
                        ease-out
                        infinite;
                }

                #${this.config.containerId} .tw-coffee-cup::after {
                    left: 45%;

                    animation:
                        tw-coffee-steam
                        2.8s
                        ease-out
                        infinite;

                    animation-delay: -1.4s;
                }

                @keyframes tw-coffee-steam {
                    0% {
                        opacity: 0;

                        transform:
                            translateY(2px)
                            scale(0.6, 0.5)
                            skewX(0deg);
                    }

                    30% {
                        opacity: 0.7;

                        transform:
                            translateY(0)
                            scale(1, 0.9)
                            skewX(4deg);
                    }

                    65% {
                        opacity: 0.4;

                        transform:
                            translateY(-3px)
                            scale(0.85, 1.2)
                            skewX(-5deg);
                    }

                    100% {
                        opacity: 0;

                        transform:
                            translateY(-5px)
                            scale(0.5, 1.5)
                            skewX(6deg);
                    }
                }

                /* =================================================
                 * COFFEE FILL
                 * ================================================= */

                #${this.config.containerId} .tw-coffee-fill {
                    transform: scaleY(0.15);
                    transform-origin: 50% 100%;

                    animation:
                        tw-coffee-refill
                        7s
                        cubic-bezier(0.45, 0, 0.55, 1)
                        infinite;
                }

                @keyframes tw-coffee-refill {
                    0% {
                        transform: scaleY(0.15);
                    }

                    30% {
                        transform: scaleY(0.95);
                    }

                    55% {
                        transform: scaleY(0.75);
                    }

                    80% {
                        transform: scaleY(0.3);
                    }

                    100% {
                        transform: scaleY(0.15);
                    }
                }

                /*
                 * Hover overrides the normal coffee cycle and fills
                 * the cup completely.
                 */
                #${this.config.containerId}
                .tw-bmc:hover
                .tw-coffee-fill {
                    animation:
                        tw-coffee-fill-to-full
                        0.45s
                        cubic-bezier(0.4, 0, 0.2, 1)
                        forwards;
                }

                @keyframes tw-coffee-fill-to-full {
                    to {
                        transform: scaleY(1);
                    }
                }

                /* =================================================
                 * SPECULAR GLEAM
                 * ================================================= */

                /*
                 * A soft diagonal highlight sweeps across the
                 * yellow button every five seconds.
                 */
                #${this.config.containerId} .tw-bmc::after {
                    content: "";

                    position: absolute;

                    top: 0;
                    bottom: 0;
                    left: -60%;

                    width: 45%;

                    pointer-events: none;

                    background:
                        linear-gradient(
                            100deg,
                            transparent 0%,
                            rgba(255, 255, 255, 0.15) 35%,
                            rgba(255, 255, 255, 0.75) 50%,
                            rgba(255, 255, 255, 0.15) 65%,
                            transparent 100%
                        );

                    transform: skewX(-18deg);

                    will-change: transform;

                    animation:
                        tw-coffee-glare
                        5s
                        cubic-bezier(0.5, 0, 0.5, 1)
                        infinite;
                }

                @keyframes tw-coffee-glare {
                    0% {
                        transform:
                            translateX(0)
                            skewX(-18deg);
                    }

                    22%,
                    100% {
                        transform:
                            translateX(400%)
                            skewX(-18deg);
                    }
                }

                /* =================================================
                 * LIQUID LABEL TRANSITION
                 * ================================================= */

                #${this.config.containerId} .tw-coffee-label {
                    display: grid;
                    align-items: center;
                    justify-items: center;

                    min-width: 0;
                }

                #${this.config.containerId} .tw-coffee-label > span {
                    grid-area: 1 / 1;

                    white-space: nowrap;

                    transform-origin: 50% 50%;

                    will-change:
                        opacity,
                        transform,
                        filter;

                    animation:
                        tw-coffee-label-drip
                        7s
                        cubic-bezier(0.65, 0, 0.35, 1)
                        infinite;
                }

                /*
                 * The second label is exactly 50% out of phase,
                 * creating the alternating liquid transition.
                 */
                #${this.config.containerId}
                .tw-coffee-label
                > span:nth-child(2) {
                    animation-delay: -3.5s;
                }

                @keyframes tw-coffee-label-drip {
                    0%,
                    34% {
                        opacity: 1;

                        transform:
                            translateY(0)
                            scale(1, 1);

                        filter: blur(0);
                    }

                    38% {
                        opacity: 0.5;

                        transform:
                            translateY(2px)
                            scale(0.94, 1.08);

                        filter: blur(1.2px);
                    }

                    42% {
                        opacity: 0;

                        transform:
                            translateY(9px)
                            scale(1.06, 0.5);

                        filter: blur(4px);
                    }

                    42.01%,
                    92% {
                        opacity: 0;

                        transform:
                            translateY(-9px)
                            scale(1.06, 0.5);

                        filter: blur(4px);
                    }

                    96% {
                        opacity: 1;

                        transform:
                            translateY(1px)
                            scale(1.05, 0.9);

                        filter: blur(0);
                    }

                    98% {
                        opacity: 1;

                        transform:
                            translateY(0)
                            scale(0.99, 1.03);

                        filter: blur(0);
                    }

                    100% {
                        opacity: 1;

                        transform:
                            translateY(0)
                            scale(1, 1);

                        filter: blur(0);
                    }
                }

                /* =================================================
                 * TORN TIP BUTTON
                 * ================================================= */

                #${this.config.containerId} .tw-torn-tip {
                    background-color: #8ab63d;
                    color: #ffffff !important;

                    border: 1px solid #6a8c2f;

                    box-shadow:
                        0 4px 6px rgba(0, 0, 0, 0.3);

                    transition:
                        transform 0.2s ease,
                        background-color 0.2s ease;
                }

                #${this.config.containerId} .tw-torn-tip:active {
                    transform: scale(0.95);
                }

                /* =================================================
                 * REDUCED MOTION
                 * ================================================= */

                @media (prefers-reduced-motion: reduce) {
                    #${this.config.containerId}
                    .tw-coffee-cup {
                        animation: none;
                    }

                    #${this.config.containerId}
                    .tw-coffee-cup::before,
                    #${this.config.containerId}
                    .tw-coffee-cup::after {
                        animation: none;
                        opacity: 0;
                    }

                    #${this.config.containerId}
                    .tw-coffee-fill {
                        animation: none;
                        transform: scaleY(0.8);
                    }

                    #${this.config.containerId}
                    .tw-coffee-label > span {
                        animation: none;
                        opacity: 0;
                        filter: none;
                        transform: none;
                    }

                    #${this.config.containerId}
                    .tw-coffee-label
                    > span:nth-child(2) {
                        opacity: 1;
                    }

                    #${this.config.containerId}
                    .tw-bmc::after {
                        animation: none;
                        opacity: 0;
                    }
                }

                /* =================================================
                 * MOBILE / TORN PDA
                 * ================================================= */

                @media (max-width: 480px) {
                    #${this.config.containerId} {
                        right: 10px;
                        bottom: 10px;
                        left: 10px;

                        width: auto;
                    }

                    #${this.config.containerId}
                    .tw-support-btn {
                        width: 100%;
                    }

                    #${this.config.containerId}
                    .tw-bmc {
                        min-width: 0;
                    }
                }
            `;

            /*
             * Preferred Tampermonkey path.
             *
             * Some restricted WebViews can expose GM_addStyle but
             * still throw when it is called. Fall back safely.
             */
            if (typeof GM_addStyle === "function") {
                try {
                    GM_addStyle(styles);
                    return;
                } catch (_) {
                    /*
                     * Fall through to normal DOM style injection.
                     */
                }
            }

            this.injectStyleElement(styles);
        }

        injectStyleElement(styles) {
            if (document.getElementById(this.config.styleId)) {
                return;
            }

            const styleNode =
                document.createElement("style");

            styleNode.id =
                this.config.styleId;

            styleNode.type =
                "text/css";

            styleNode.textContent =
                styles;

            if (document.head) {
                document.head.appendChild(styleNode);
                return;
            }

            const body = this.getBody();

            if (body) {
                body.appendChild(styleNode);
            }
        }

        /* ========================================================
         * COFFEE BUTTON
         * ======================================================== */

        buildCoffeeButton() {
            coffeeInstanceCount += 1;

            const clipId =
                `tw-coffee-clip-${coffeeInstanceCount}`;

            const bmcLink =
                document.createElement("a");

            bmcLink.className =
                "tw-support-btn tw-bmc";

            bmcLink.href =
                `https://www.buymeacoffee.com/${encodeURIComponent(
                    this.config.bmcId
                )}`;

            bmcLink.target = "_blank";

            bmcLink.rel =
                "noopener noreferrer";

            bmcLink.title =
                "Support ThaWookie";

            bmcLink.setAttribute(
                "aria-label",
                "Buy me a coffee — support ThaWookie"
            );

            /*
             * ----------------------------------------------------
             * Animated coffee cup
             * ----------------------------------------------------
             */

            const cup =
                document.createElement("span");

            cup.className =
                "tw-coffee-cup";

            cup.setAttribute(
                "aria-hidden",
                "true"
            );

            const svg =
                document.createElementNS(
                    "http://www.w3.org/2000/svg",
                    "svg"
                );

            svg.setAttribute(
                "width",
                "16"
            );

            svg.setAttribute(
                "height",
                "16"
            );

            svg.setAttribute(
                "viewBox",
                "0 0 24 24"
            );

            svg.setAttribute(
                "fill",
                "none"
            );

            svg.setAttribute(
                "stroke",
                "currentColor"
            );

            svg.setAttribute(
                "stroke-width",
                "1.5"
            );

            svg.setAttribute(
                "aria-hidden",
                "true"
            );

            /*
             * SVG clip path.
             *
             * This is intentionally generated through DOM APIs
             * rather than innerHTML so the only dynamic value,
             * clipId, cannot become an HTML injection vector.
             */

            const defs =
                document.createElementNS(
                    "http://www.w3.org/2000/svg",
                    "defs"
                );

            const clipPath =
                document.createElementNS(
                    "http://www.w3.org/2000/svg",
                    "clipPath"
                );

            clipPath.setAttribute(
                "id",
                clipId
            );

            const clipShape =
                document.createElementNS(
                    "http://www.w3.org/2000/svg",
                    "path"
                );

            clipShape.setAttribute(
                "d",
                "M5 8h11v5a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V8z"
            );

            clipPath.appendChild(
                clipShape
            );

            defs.appendChild(
                clipPath
            );

            svg.appendChild(
                defs
            );

            /*
             * Coffee liquid.
             *
             * The CSS transform animation controls its visible
             * fill level.
             */
            const coffeeFill =
                document.createElementNS(
                    "http://www.w3.org/2000/svg",
                    "rect"
                );

            coffeeFill.setAttribute(
                "class",
                "tw-coffee-fill"
            );

            coffeeFill.setAttribute(
                "x",
                "5"
            );

            coffeeFill.setAttribute(
                "y",
                "8"
            );

            coffeeFill.setAttribute(
                "width",
                "11"
            );

            coffeeFill.setAttribute(
                "height",
                "9"
            );

            coffeeFill.setAttribute(
                "fill",
                "#6f4e37"
            );

            coffeeFill.setAttribute(
                "stroke",
                "none"
            );

            coffeeFill.setAttribute(
                "clip-path",
                `url(#${clipId})`
            );

            svg.appendChild(
                coffeeFill
            );

            /*
             * Cup body outline.
             */
            const cupBody =
                document.createElementNS(
                    "http://www.w3.org/2000/svg",
                    "path"
                );

            cupBody.setAttribute(
                "stroke-linecap",
                "round"
            );

            cupBody.setAttribute(
                "stroke-linejoin",
                "round"
            );

            cupBody.setAttribute(
                "d",
                "M5 8h11v5a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V8z"
            );

            svg.appendChild(
                cupBody
            );

            /*
             * Cup handle.
             */
            const cupHandle =
                document.createElementNS(
                    "http://www.w3.org/2000/svg",
                    "path"
                );

            cupHandle.setAttribute(
                "stroke-linecap",
                "round"
            );

            cupHandle.setAttribute(
                "stroke-linejoin",
                "round"
            );

            cupHandle.setAttribute(
                "d",
                "M16 9h2.5a2.5 2.5 0 0 1 0 5H16"
            );

            svg.appendChild(
                cupHandle
            );

            cup.appendChild(
                svg
            );

            bmcLink.appendChild(
                cup
            );

            /*
             * ----------------------------------------------------
             * Animated label
             * ----------------------------------------------------
             */

            const label =
                document.createElement("span");

            label.className =
                "tw-coffee-label";

            label.setAttribute(
                "aria-hidden",
                "true"
            );

            const supportLabel =
                document.createElement("span");

            supportLabel.textContent =
                "Support the project?";

            const coffeeLabel =
                document.createElement("span");

            coffeeLabel.textContent =
                "Buy me a coffee";

            label.appendChild(
                supportLabel
            );

            label.appendChild(
                coffeeLabel
            );

            bmcLink.appendChild(
                label
            );

            return bmcLink;
        }

        /* ========================================================
         * UI INJECTION
         * ======================================================== */

        injectUI() {
            if (
                this.destroyed ||
                this.isInjecting
            ) {
                return;
            }

            const body =
                this.getBody();

            if (!body) {
                return;
            }

            if (this.isContainerConnected()) {
                return;
            }

            this.isInjecting = true;

            try {
                /*
                 * Remove stale disconnected node, if present.
                 */
                const existingContainer =
                    this.getContainer();

                if (existingContainer) {
                    existingContainer.remove();
                }

                const container =
                    document.createElement("div");

                container.id =
                    this.config.containerId;

                container.setAttribute(
                    "role",
                    "complementary"
                );

                container.setAttribute(
                    "aria-label",
                    "Support ThaWookie"
                );

                /*
                 * Animated Buy Me a Coffee button.
                 */
                const bmcLink =
                    this.buildCoffeeButton();

                /*
                 * ------------------------------------------------
                 * Torn Xanax Tip
                 * ------------------------------------------------
                 */

                const tipLink =
                    document.createElement("a");

                tipLink.href =
                    "https://www.torn.com/item.php";

                tipLink.target =
                    "_blank";

                tipLink.rel =
                    "noopener noreferrer";

                tipLink.className =
                    "tw-support-btn tw-torn-tip";

                tipLink.title =
                    `Opens Items — search "Xanax", ` +
                    `tap Send, enter ThaWookie ` +
                    `[${this.config.tornUserId}]`;

                tipLink.setAttribute(
                    "aria-label",
                    `Send a Xanax tip to ThaWookie ` +
                    `[${this.config.tornUserId}]`
                );

                tipLink.textContent =
                    "💊 Send a Xanax Tip";

                /*
                 * Assemble donation controls.
                 */
                container.appendChild(
                    bmcLink
                );

                container.appendChild(
                    tipLink
                );

                /*
                 * Append directly to body so React does not own
                 * the donation UI's DOM subtree.
                 */
                body.appendChild(
                    container
                );
            } finally {
                this.isInjecting = false;
            }
        }

        /* ========================================================
         * MUTATION OBSERVER
         * ======================================================== */

        attachObserver() {
            if (
                this.destroyed ||
                this.observerAttached ||
                typeof MutationObserver === "undefined"
            ) {
                return;
            }

            const body =
                this.getBody();

            if (!body) {
                return;
            }

            this.observer =
                new MutationObserver(
                    (mutationList) => {
                        if (
                            this.destroyed ||
                            this.isInjecting
                        ) {
                            return;
                        }

                        let relevantMutation =
                            false;

                        for (
                            const mutation
                            of mutationList
                        ) {
                            if (
                                mutation.type !==
                                "childList"
                            ) {
                                continue;
                            }

                            if (
                                mutation.removedNodes
                                    .length > 0
                            ) {
                                relevantMutation =
                                    true;

                                break;
                            }
                        }

                        if (
                            !relevantMutation
                        ) {
                            return;
                        }

                        if (
                            !this.isContainerConnected()
                        ) {
                            this.injectStyles();
                            this.injectUI();
                        }
                    }
                );

            this.observer.observe(
                body,
                {
                    childList: true,
                    subtree: true
                }
            );

            this.observerAttached = true;
        }

        /* ========================================================
         * CLEANUP
         * ======================================================== */

        destroy() {
            this.destroyed = true;

            if (this.observer) {
                try {
                    this.observer.disconnect();
                } catch (_) {
                    /*
                     * Nothing further required.
                     */
                }
            }

            this.observer = null;
            this.observerAttached = false;

            const container =
                this.getContainer();

            if (container) {
                container.remove();
            }
        }
    }

    /* ============================================================
     * MODULE STARTUP
     * ============================================================ */

    function startSupportModule() {
        return new SupportModule();
    }

    /*
     * Respect normal document lifecycle.
     *
     * No setTimeout().
     * No setInterval().
     * No polling.
     */
    if (
        document.readyState ===
        "loading"
    ) {
        document.addEventListener(
            "DOMContentLoaded",
            startSupportModule,
            { once: true }
        );
    } else {
        startSupportModule();
    }
})();
(function(){'use strict';
const MyDebug=initializeModularDebugger(GM_info.script.name);
const get=(k,d='')=>{try{return GM_getValue(k,d)}catch(_){return localStorage.getItem('tmm_'+k)||d}};
const put=(k,v)=>{try{GM_setValue(k,v)}catch(_){localStorage.setItem('tmm_'+k,v)}};
const style=document.createElement('style');style.textContent=`#tmm-panel{position:fixed;right:12px;bottom:12px;z-index:2147483630;background:#15232c;color:white;padding:12px;border:1px solid #dbb547;border-radius:8px;width:min(340px,calc(100vw - 24px));font:13px Arial;box-shadow:0 5px 20px #0008}#tmm-panel input,#tmm-panel select{width:100%;box-sizing:border-box;margin:4px 0 9px;padding:7px;background:#fff;color:#111}#tmm-panel button{margin:3px;padding:7px;cursor:pointer}#tmm-panel label{display:block}#tmm-panel .tmm-hide{display:none}#tmm-panel a{color:#ffd34f}`;document.head.appendChild(style);
const panel=document.createElement('section');panel.id='tmm-panel';panel.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center"><strong>🎯 Mug Marks Tracker v1.0.0</strong><button id="tmm-collapse">Hide</button></div><div id="tmm-main"><label>Target Torn ID<input id="tmm-id" inputmode="numeric" placeholder="Numeric player ID"></label><label>Target name<input id="tmm-name" maxlength="80"></label><label>Pipeline<select id="tmm-pipe"><option>Manual</option><option>HoF Inactive</option><option>Buy-Mug</option><option>Casino</option><option>Overseas</option></select></label><label>Notes<input id="tmm-notes" maxlength="500"></label><button id="tmm-save">Save Target</button><label>Cash yield ($)<input id="tmm-yield" type="number" min="0" value="0"></label><label>Outcome<select id="tmm-outcome"><option>Success</option><option>Failed</option><option>Other</option></select></label><button id="tmm-mug">Log Mug (now UTC)</button><button id="tmm-settings-toggle">⚙ Settings</button><div id="tmm-settings" class="tmm-hide"><label>Apps Script web app /exec URL<input id="tmm-url" placeholder="https://script.google.com/macros/s/.../exec"></label><label>Write token<input id="tmm-token" type="password" autocomplete="off"></label><button id="tmm-config-save">Save Connection</button><div id="tmm-support"></div><button id="tmm-debug">🪲</button><button id="tmm-copy">📋 Copy Logs to Clipboard</button></div><div id="tmm-status" role="status" aria-live="polite"></div></div>`;
const el=id=>panel.querySelector('#'+id);const status=t=>el('tmm-status').textContent=t;
function hydrate(){const match=location.search.match(/[?&](?:XID|user2ID|ID)=(\d+)/i);if(match)el('tmm-id').value=match[1];const title=document.title.match(/^([^|]+)\s*\|/);if(title)el('tmm-name').value=title[1].trim();}
async function send(data){const url=get('url'),token=get('token');if(!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(url)||!token){status('Configure URL and token first.');return}const payload=JSON.stringify({...data,token});status('Sending...');MyDebug.log({action:data.action,id:data.id});try{const r=await new Promise((resolve,reject)=>{if(typeof GM_xmlhttpRequest!=='function'){reject(Error('GM_xmlhttpRequest unavailable'));return}GM_xmlhttpRequest({method:'POST',url,data:payload,headers:{'Content-Type':'text/plain;charset=utf-8'},timeout:20000,onload:resolve,onerror:()=>reject(Error('Network error')),ontimeout:()=>reject(Error('Request timed out'))})});let result;try{result=JSON.parse(r.responseText)}catch(_){throw Error('Unexpected response from Apps Script; check deployment permissions and redirect support')}if(!result.ok)throw Error(result.error||'Rejected');status(result.duplicate?'Already logged':'Saved to Google Sheets');MyDebug.log({action:data.action,result:'success'})}catch(err){status('Sync failed: '+err.message);MyDebug.error({action:data.action,error:err.message})}}
function target(){const id=el('tmm-id').value.trim();if(!/^\d{1,12}$/.test(id)){status('Enter a valid Torn ID');return null}return {id,name:el('tmm-name').value.trim(),pipeline:el('tmm-pipe').value,notes:el('tmm-notes').value.trim()}}
el('tmm-save').onclick=()=>{const d=target();if(d)void send({...d,action:'target'})};
el('tmm-mug').onclick=()=>{const d=target();if(!d)return;const yieldValue=Number(el('tmm-yield').value);if(!Number.isFinite(yieldValue)||yieldValue<0){status('Invalid cash yield');return}const eventId='manual-'+Date.now()+'-'+Math.random().toString(36).slice(2,10);void send({...d,action:'mug',eventId,time:new Date().toISOString(),yield:yieldValue,outcome:el('tmm-outcome').value})};
el('tmm-collapse').onclick=()=>{const body=el('tmm-main');const hide=body.style.display!=='none';body.style.display=hide?'none':'block';el('tmm-collapse').textContent=hide?'Show':'Hide'};
el('tmm-settings-toggle').onclick=()=>el('tmm-settings').classList.toggle('tmm-hide');el('tmm-url').value=get('url');el('tmm-token').value=get('token');el('tmm-config-save').onclick=()=>{put('url',el('tmm-url').value.trim());put('token',el('tmm-token').value.trim());status('Connection saved locally')};el('tmm-debug').onclick=()=>MyDebug.toggleView();el('tmm-copy').onclick=function(){void MyDebug.copy(this)};
// The original donation module runs independently below. Its controls are moved into Settings after initialization.
function attach(){if(!document.body)return; if(!panel.isConnected)document.body.appendChild(panel);const support=document.getElementById('thawookie-support-module');if(support&&support.parentNode!==el('tmm-support')){el('tmm-support').appendChild(support);support.style.position='static';support.style.width='100%';support.style.margin='8px 0';support.style.flexDirection='column';support.style.display='flex'}}
const observer=new MutationObserver(()=>{if(!panel.isConnected||document.getElementById('thawookie-support-module')?.parentNode!==el('tmm-support'))attach()});
function start(){hydrate();attach();observer.observe(document.body,{childList:true,subtree:true});MyDebug.log('Tracker initialized')}
if(document.body)start();else document.addEventListener('DOMContentLoaded',start,{once:true});
})();
