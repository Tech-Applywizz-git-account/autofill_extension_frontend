// extension/src/content/scanner/dropdownScanner.ts
/**
 * DropdownScanner - Extracts all options from dropdown fields
 * Uses ProductionDropdown's PROVEN keyboard-first logic
 */

const LOG_PREFIX = "[DropdownScanner]";

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if element is visible
 * Copied from FormScanner to ensure standalone functionality
 */
function isVisible(element: Element): boolean {
    const htmlElement = element as HTMLElement;
    const style = window.getComputedStyle(htmlElement);

    if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.opacity === '0'
    ) {
        return false;
    }

    if (document.hidden) {
        return true; // Bypass layout dimension check when minimized/hidden
    }

    const rect = htmlElement.getBoundingClientRect();
    return (
        rect.width > 0 &&
        rect.height > 0
    );
}

/**
 * Dispatch keyboard event (SAME AS ProductionDropdown)
 */
function dispatchKeyEvent(element: HTMLElement, key: string, code: string) {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keypress', { key, code, bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keyup', { key, code, bubbles: true }));
}

/**
 * Get the currently VISIBLE dropdown menu element
 * strict visibility check ensures we don't pick up hidden menus (like phone codes)
 */
function getVisibleDropdownMenu(): Element | null {
    const menuSelectors = [
        '.select__menu',
        '[role="listbox"]',
        '[role="menu"]',
        '.dropdown-menu',
        '[class*="menu"]',    // Broadened to catch specific class names
        '[class*="option"]'   // Some menus are just containers of options
    ];

    // Priority 1: Check standard selectors with visibility check
    for (const selector of menuSelectors) {
        const elements = document.querySelectorAll(selector);
        for (const el of Array.from(elements)) {
            // Must be visible
            if (isVisible(el)) {
                // Heuristic: Dropdown menus usually have multiple children or specific attributes
                if (el.children.length > 0 || el.getAttribute('role') === 'listbox') {
                    // console.log(`${LOG_PREFIX} 🎯 Found visible menu with selector: "${selector}"`);
                    return el;
                }
            }
        }
    }

    // Priority 2: Look for aria-expanded content
    const expanded = document.querySelector('[aria-expanded="true"]');
    if (expanded) {
        const controls = expanded.getAttribute('aria-controls');
        if (controls) {
            const menu = document.getElementById(controls);
            if (menu && isVisible(menu)) return menu;
        }
        // Sometimes the menu is the next sibling
        const next = expanded.nextElementSibling;
        if (next && isVisible(next)) return next;
    }

    return null;
}

/**
 * Helper to set value on React inputs
 * Triggers native events so React notices the change
 */
function setNativeValue(element: HTMLInputElement, value: string) {
    const valueSetter = Object.getOwnPropertyDescriptor(element, 'value')?.set;
    const prototype = Object.getPrototypeOf(element);
    const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

    if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
        prototypeValueSetter.call(element, value);
    } else if (valueSetter) {
        valueSetter.call(element, value);
    } else {
        element.value = value;
    }

    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true })); // Add change event for good measure
}

/**
 * Wait for dropdown menu to appear using MutationObserver
 */
function waitForDropdownMenu(timeout: number = 1000): Promise<boolean> { // Reduced from 2000ms
    return new Promise((resolve) => {
        // Check if menu already exists
        if (getVisibleDropdownMenu()) {
            resolve(true);
            return;
        }

        const observer = new MutationObserver(() => {
            if (getVisibleDropdownMenu()) {
                observer.disconnect();
                resolve(true);
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true, // Watch for class/style changes too
            attributeFilter: ['style', 'class', 'hidden']
        });

        setTimeout(() => {
            observer.disconnect();
            resolve(!!getVisibleDropdownMenu());
        }, timeout);
    });
}

/**
 * Find input element within dropdown control
 */
function findDropdownInput(element: HTMLElement): HTMLInputElement | null {
    // If element itself is an input
    if (element instanceof HTMLInputElement) {
        return element;
    }

    // Look for input with role="combobox"
    let input = element.querySelector('input[role="combobox"]') as HTMLInputElement;
    if (input) return input;

    // Look for any input
    input = element.querySelector('input') as HTMLInputElement;
    if (input) return input;

    // Look in parent
    const parent = element.closest('[role="combobox"]');
    if (parent) {
        input = parent.querySelector('input') as HTMLInputElement;
        if (input) return input;
    }

    return null;
}

/**
 * Check if dropdown menu is currently open (and visible)
 */
async function isMenuOpen(): Promise<boolean> {
    return !!getVisibleDropdownMenu();
}

/**
 * Open dropdown using keyboard (SAME AS ProductionDropdown - PROVEN TO WORK!)
 */
async function openDropdownWithKeyboard(input: HTMLInputElement): Promise<boolean> {
    console.log(`${LOG_PREFIX} 🔓 Opening with keyboard...`);

    // Priority 1: ArrowDown (Safest - usually opens without typing/filtering)
    dispatchKeyEvent(input, 'ArrowDown', 'ArrowDown');
    await sleep(50); // Aggressive but safe

    if (await isMenuOpen()) {
        console.log(`${LOG_PREFIX} ✅ Opened with ArrowDown`);
        return true;
    }

    // Priority 2: Space (Works for most, but triggers filtering if not empty)
    dispatchKeyEvent(input, ' ', 'Space');
    await sleep(50);

    if (await isMenuOpen()) {
        console.log(`${LOG_PREFIX} ✅ Opened with Space`);
        return true;
    }

    // Priority 3: Enter (Last resort)
    dispatchKeyEvent(input, 'Enter', 'Enter');
    await sleep(50);

    if (await isMenuOpen()) {
        console.log(`${LOG_PREFIX} ✅ Opened with Enter`);
        return true;
    }

    console.warn(`${LOG_PREFIX} ⚠️ Keyboard open failed, trying click fallback`);
    // Fallback: click the control
    const control = input.closest('.select__control') || input.parentElement;
    if (control) {
        (control as HTMLElement).click();
        await sleep(50);
        return isMenuOpen();
    }

    return false;
}

/**
 * Close dropdown using Escape key
 */
async function closeDropdown(input: HTMLInputElement): Promise<void> {
    try {
        dispatchKeyEvent(input, 'Escape', 'Escape');
        // Also try blur
        input.blur();
        await sleep(100);
    } catch (error) {
        console.error(`${LOG_PREFIX} Error closing dropdown:`, error);
    }
}

/**
 * Extract options from native <select> element
 */
export function extractNativeOptions(select: HTMLSelectElement): string[] {
    const options: string[] = [];

    for (const option of Array.from(select.options)) {
        const text = option.textContent?.trim();
        if (text && text !== '' && text !== '--' && text.toLowerCase() !== 'select') {
            options.push(text);
        }
    }

    console.log(`${LOG_PREFIX} 📋 Extracted ${options.length} native options`);
    return options;
}

/**
 * Helper to find the scrollable container inside the menu
 */
function findScrollableContainer(menu: HTMLElement): HTMLElement {
    if (menu.scrollHeight > menu.clientHeight) {
        return menu;
    }
    // Search children for the scrollable container
    const children = menu.querySelectorAll('*');
    for (const child of Array.from(children)) {
        const htmlChild = child as HTMLElement;
        if (htmlChild.scrollHeight > htmlChild.clientHeight) {
            return htmlChild;
        }
    }
    return menu;
}

/**
 * Extract options from custom dropdown (React-Select, etc.)
 * Uses ProductionDropdown's PROVEN opening logic
 */
export async function extractCustomOptions(element: HTMLElement): Promise<string[]> {
    const options: string[] = [];

    try {
        // Find the input element
        const input = findDropdownInput(element);
        if (!input) {
            console.warn(`${LOG_PREFIX} ⚠️ Could not find dropdown input`);
            return options;
        }

        console.log(`${LOG_PREFIX} 🔍 Opening dropdown to extract options...`);

        // Focus first
        input.focus();
        await sleep(100);

        // CLEAR INPUT: Critical fix for "No options" issue
        // If input has text, it filters the dropdown. We must clear it to see all options.
        if (input.value) {
            console.log(`${LOG_PREFIX} 🧹 Clearing input value before opening: "${input.value}"`);
            setNativeValue(input, '');
            await sleep(50);
        }

        // Open the dropdown using ProductionDropdown's proven method
        const opened = await openDropdownWithKeyboard(input);
        if (!opened) {
            console.warn(`${LOG_PREFIX} ⚠️ Failed to open dropdown`);
            return options;
        }

        // Wait for menu to appear (aggressive timeout)
        const menuAppeared = await waitForDropdownMenu(1500); // 1.5s timeout
        if (!menuAppeared) {
            console.warn(`${LOG_PREFIX} ⚠️ Menu did not appear after opening`);
            await closeDropdown(input);
            return options;
        }

        // Wait a bit for options to render
        await sleep(100);

        // Get the menu element (MUST be the visible one)
        const menu = getVisibleDropdownMenu();
        if (!menu) {
            console.warn(`${LOG_PREFIX} ⚠️ Menu lost visibility or not found`);
            await closeDropdown(input);
            return options;
        }

        // Extract option text from menu items
        // Refined selectors for options
        const optionSelectors = [
            '[role="option"]',
            '.select__option',
            '.Select-option',
            '[class*="option"]',
            'li', // generic list items in a menu
            '.dropdown-item'
        ];

        // Wait up to 500ms for options to appear in the menu
        console.log(`${LOG_PREFIX} ⏳ Waiting up to 0.5s for options to render...`);
        let optionsFound = false;
        const startTime = Date.now();
        while (Date.now() - startTime < 500) {
            const allElements = menu.querySelectorAll(optionSelectors.join(', '));
            const visibleOptions = Array.from(allElements).filter(el => isVisible(el));
            if (visibleOptions.length > 0) {
                optionsFound = true;
                break;
            }
            await sleep(50);
        }

        if (!optionsFound) {
            console.warn(`${LOG_PREFIX} ⚠️ No options rendered in the dropdown menu after waiting 0.5s`);
            await closeDropdown(input);
            return options;
        }

        // Find the scrollable container to pull virtualized dropdown options
        const scrollContainer = findScrollableContainer(menu as HTMLElement);
        console.log(`${LOG_PREFIX} 📜 Scrollable container identified:`, scrollContainer);

        let lastScrollTop = -1;
        let sameScrollCount = 0;
        const maxScrollAttempts = 1000; // Large safety ceiling to support deep dropdown lists (A-Z)
        let attempts = 0;
        let loopStartTime = Date.now();
        const maxTimeMs = 2000; // 3 seconds budget limit per inactivity period

        while (attempts < maxScrollAttempts) {
            // Check time budget
            if (Date.now() - loopStartTime >= maxTimeMs) {
                console.log(`${LOG_PREFIX} ⏱️ Time budget of ${maxTimeMs}ms exceeded without new options/lazy-load. Stopping scroll.`);
                break;
            }

            // 1. Collect options currently visible in the DOM
            const allElements = menu.querySelectorAll(optionSelectors.join(', '));
            let newOptionsFound = false;

            for (const optionEl of Array.from(allElements)) {
                if (!isVisible(optionEl)) continue;
                const text = optionEl.textContent?.trim();
                if (text && text.length > 1 && !options.includes(text)) {
                    options.push(text);
                    newOptionsFound = true;
                }
            }

            if (newOptionsFound) {
                console.log(`${LOG_PREFIX} 📜 Extracted options batch. Total so far: ${options.length}`);
                // Refill the time budget because we successfully found new options
                loopStartTime = Date.now();
            }

            // 2. Check scroll height metrics
            const currentScrollTop = scrollContainer.scrollTop;
            const maxScroll = scrollContainer.scrollHeight - scrollContainer.clientHeight;

            // If we are at the bottom of the scroll container or it isn't scrolling any further
            if (currentScrollTop >= maxScroll - 5 || currentScrollTop === lastScrollTop) {
                console.log(`${LOG_PREFIX} ⏳ Reached apparent bottom, waiting for potential lazy load...`);
                const initialOptionsCount = options.length;
                const initialScrollHeight = scrollContainer.scrollHeight;
                let lazyLoaded = false;

                const lazyWaitStart = Date.now();
                // Wait up to 2000ms (2 seconds) for lazy loaded options to render
                while (Date.now() - lazyWaitStart < 2000) {
                    if (Date.now() - loopStartTime >= maxTimeMs) break;

                    // Dispatch scroll event to trigger lazy load listener
                    scrollContainer.dispatchEvent(new Event('scroll', { bubbles: true }));
                    if (scrollContainer !== menu) {
                        menu.dispatchEvent(new Event('scroll', { bubbles: true }));
                    }

                    await sleep(100);

                    // Scan again
                    const checkElements = menu.querySelectorAll(optionSelectors.join(', '));
                    for (const optionEl of Array.from(checkElements)) {
                        if (!isVisible(optionEl)) continue;
                        const text = optionEl.textContent?.trim();
                        if (text && text.length > 1 && !options.includes(text)) {
                            options.push(text);
                        }
                    }

                    if (scrollContainer.scrollHeight > initialScrollHeight || options.length > initialOptionsCount) {
                        lazyLoaded = true;
                        console.log(`${LOG_PREFIX} 🔄 Lazy load detected! ScrollHeight increased or new options found.`);
                        // Refill the time budget because we made lazy load progress
                        loopStartTime = Date.now();
                        break;
                    }
                }

                if (!lazyLoaded) {
                    sameScrollCount++;
                    if (sameScrollCount >= 2) {
                        console.log(`${LOG_PREFIX} 🏁 Reached absolute bottom of dropdown. Stopping scroll.`);
                        break;
                    }
                } else {
                    sameScrollCount = 0;
                }
            } else {
                sameScrollCount = 0;
            }

            lastScrollTop = currentScrollTop;

            // 3. Scroll down page-by-page
            const scrollStep = Math.max(scrollContainer.clientHeight - 20, 150);
            scrollContainer.scrollTop += scrollStep;
            if (scrollContainer !== menu) {
                (menu as HTMLElement).scrollTop += scrollStep;
            }

            // Dispatch scroll event for virtualized list frameworks (React-Virtual/react-window)
            scrollContainer.dispatchEvent(new Event('scroll', { bubbles: true }));
            if (scrollContainer !== menu) {
                menu.dispatchEvent(new Event('scroll', { bubbles: true }));
            }

            // 4. Wait for new elements to render
            await sleep(100);
            attempts++;
        }

        console.log(`${LOG_PREFIX} ✅ Extracted ${options.length} custom dropdown options from menu.`);

        // Close the dropdown
        await closeDropdown(input);

    } catch (error) {
        console.error(`${LOG_PREFIX} Error extracting custom options:`, error);
    }

    return options;
}

/**
 * Main function to extract options from any dropdown
 */
export async function extractDropdownOptions(element: HTMLElement): Promise<string[]> {
    // 1. Check if it's a custom dropdown container (even if it has a hidden native select)
    // Greenhouse and other platforms use custom UI that wraps a hidden native select
    const isCustom = element.querySelector('[role="combobox"], [class*="select"], [class*="dropdown"]') ||
        element.getAttribute('role') === 'combobox' ||
        element.classList.contains('select__control');

    if (isCustom) {
        console.log(`${LOG_PREFIX} 🎯 Custom dropdown detected, extracting custom options...`);
        const customOptions = await extractCustomOptions(element);
        if (customOptions.length > 0) return customOptions;
    }

    // 2. Fallback to native select if no custom options found or not a custom dropdown
    if (element instanceof HTMLSelectElement) {
        return extractNativeOptions(element);
    }

    const select = element.querySelector('select');
    if (select) {
        return extractNativeOptions(select as HTMLSelectElement);
    }

    // 3. Final attempt as custom if everything else fails
    return await extractCustomOptions(element);
}
