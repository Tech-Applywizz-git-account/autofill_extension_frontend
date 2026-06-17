import { CONFIG } from "../../config";

export interface AnalyticsEvent {
    user_email?: string;
    user_name?: string;
    url: string;
    scan_duration_ms: number;
    total_questions: number;
    mapping_duration_ms: number;
    mapped_by_rules: number;
    ai_questions_count: number;
    ai_calls_count: number;
    learned_patterns_used: number;
    filling_duration_ms: number;
    filled_success_count: number;
    filled_failed_count: number;
    missed_questions: string[];
    all_questions: string[];
    total_process_time_ms: number;
    company_name?: string;
    job_title?: string;
    total_tokens_used?: number;
    total_input_tokens?: number;
    total_output_tokens?: number;
}

export class AnalyticsTracker {
    private static instance: AnalyticsTracker;
    private startTime: number = 0;
    private scanStartTime: number = 0;
    private scanEndTime: number = 0;
    private mapStartTime: number = 0;
    private mapEndTime: number = 0;
    private fillStartTime: number = 0;
    private fillEndTime: number = 0;

    // Counts
    private totalQuestions: number = 0;
    private allQuestions: string[] = [];
    private rulesMapped: number = 0;
    private aiQuestionsCount: number = 0;
    private aiCallsIndex: number = 0; // Tracked via event listener if possible or manual increment
    private patternsUsed: number = 0;
    private successCount: number = 0;
    private failCount: number = 0;
    private missedQuestions: string[] = [];
    private inputTokens: number = 0;
    private outputTokens: number = 0;

    private constructor() {
        this.reset();
    }

    public static getInstance(): AnalyticsTracker {
        if (!AnalyticsTracker.instance) {
            AnalyticsTracker.instance = new AnalyticsTracker();
        }
        return AnalyticsTracker.instance;
    }

    public reset() {
        this.startTime = Date.now();
        this.scanStartTime = 0;
        this.scanEndTime = 0;
        this.mapStartTime = 0;
        this.mapEndTime = 0;
        this.fillStartTime = 0;
        this.fillEndTime = 0;
        this.totalQuestions = 0;
        this.allQuestions = [];
        this.rulesMapped = 0;
        this.aiQuestionsCount = 0;
        this.aiCallsIndex = 0;
        this.patternsUsed = 0;
        this.successCount = 0;
        this.failCount = 0;
        this.missedQuestions = [];
        this.inputTokens = 0;
        this.outputTokens = 0;
    }

    // --- Timers ---

    public startScan() {
        this.startTime = Date.now(); // Reset total start time on new scan
        this.scanStartTime = Date.now();
    }

    public endScan(questions: any[]) {
        this.scanEndTime = Date.now();
        this.totalQuestions = questions.length;
        // Extract question texts for analytics
        this.allQuestions = questions.map(q => q.questionText || q.question || 'unknown');
    }

    public startMapping() {
        this.mapStartTime = Date.now();
    }

    public endMapping(results: any[]) {
        this.mapEndTime = Date.now();
        // Calculate mapping stats based on MappedAnswer.source
        // Sources: 'canonical', 'learned', 'fuzzy', 'AI', 'injected_skills', 'hardcoded_override'
        this.rulesMapped = results.filter(r =>
            r.source === 'canonical' ||
            r.source === 'fuzzy' ||
            r.source === 'injected_skills' ||
            r.source === 'hardcoded_override'
        ).length;
        this.patternsUsed = results.filter(r => r.source === 'learned').length;
        this.aiQuestionsCount = results.filter(r => r.source === 'AI').length;
    }

    public startFilling() {
        this.fillStartTime = Date.now();
    }

    public endFilling() {
        this.fillEndTime = Date.now();
    }

    public incrementAICall() {
        this.aiCallsIndex++;
    }

    public addTokens(input: number, output: number) {
        this.inputTokens += input;
        this.outputTokens += output;
        console.log(`[AnalyticsTracker] 🎫 Added tokens - input: ${input}, output: ${output} (total accumulated: ${this.inputTokens + this.outputTokens})`);
    }

    // --- Results ---

    public trackFillResult(question: string, success: boolean) {
        if (success) {
            this.successCount++;
        } else {
            this.failCount++;
            this.missedQuestions.push(question);
        }
    }

    /**
     * Override auto-calculated counts with manual user feedback
     */
    public setManualCounts(success: number, fail: number) {
        this.successCount = success;
        this.failCount = fail;
        this.totalQuestions = success + fail;
    }

    // --- Submission ---

    public async submit(): Promise<boolean> {
        try {
            // Get user identity from storage (CORRECT KEY)
            const storage = await chrome.storage.local.get(['autofill_canonical_profile']);
            const profile = storage.autofill_canonical_profile;

            const email = profile?.personal?.email || 'anonymous';
            const name = `${profile?.personal?.firstName || ''} ${profile?.personal?.lastName || ''}`.trim();

            const scanDuration = this.scanEndTime - this.scanStartTime;
            const mapDuration = this.mapEndTime - this.mapStartTime;
            const fillDuration = this.fillEndTime - this.fillStartTime;
            const totalDuration = Date.now() - this.startTime;

            const getCompanyNameFromUrl = (urlStr: string): string => {
                try {
                    const url = new URL(urlStr);
                    const hostname = url.hostname;
                    
                    if (hostname.includes('greenhouse.io')) {
                        const pathParts = url.pathname.split('/').filter(Boolean);
                        if (pathParts.length > 0) return pathParts[0];
                    }
                    if (hostname.includes('lever.co')) {
                        const pathParts = url.pathname.split('/').filter(Boolean);
                        if (pathParts.length > 0) return pathParts[0];
                    }
                    if (hostname.includes('myworkdayjobs.com')) {
                        return hostname.split('.')[0];
                    }
                    const parts = hostname.split('.');
                    if (parts.length > 2) {
                        return parts[parts.length - 2];
                    }
                    return parts[0];
                } catch {
                    return '';
                }
            };

            const parseJobDetails = (): { company: string; title: string } => {
                let company = '';
                let title = '';

                try {
                    const titleText = document.title;
                    if (titleText.includes(' at ')) {
                        const parts = titleText.split(' at ');
                        title = parts[0].trim();
                        company = parts[1].trim();
                    } else if (titleText.includes(' - ')) {
                        const parts = titleText.split(' - ');
                        company = parts[parts.length - 1].trim();
                        title = parts.slice(0, -1).join(' - ').trim();
                    } else {
                        title = titleText;
                    }

                    if (title.includes(' | ')) {
                        title = title.split(' | ')[0].trim();
                    }
                } catch (e) {
                    console.warn('Failed to parse job details from title:', e);
                }

                const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
                
                if (!company) {
                    company = getCompanyNameFromUrl(window.location.href);
                }
                if (company) {
                    company = capitalize(company);
                }

                return { company, title };
            };

            const jobDetails = parseJobDetails();

            const payload: AnalyticsEvent = {
                user_email: email,
                user_name: name,
                url: window.location.href,
                all_questions: this.allQuestions,
                scan_duration_ms: scanDuration > 0 ? scanDuration : 0,
                total_questions: this.totalQuestions,
                mapping_duration_ms: mapDuration > 0 ? mapDuration : 0,
                mapped_by_rules: this.rulesMapped,
                ai_questions_count: this.aiQuestionsCount,
                ai_calls_count: this.aiCallsIndex,
                learned_patterns_used: this.patternsUsed,
                filling_duration_ms: fillDuration > 0 ? fillDuration : 0,
                filled_success_count: this.successCount,
                filled_failed_count: this.failCount,
                missed_questions: this.missedQuestions,
                total_process_time_ms: totalDuration > 0 ? totalDuration : 0,
                company_name: jobDetails.company,
                job_title: jobDetails.title,
                total_tokens_used: this.inputTokens + this.outputTokens,
                total_input_tokens: this.inputTokens,
                total_output_tokens: this.outputTokens
            };

            console.log('📊 Submitting Analytics:', payload);

            // Send to background to proxy to backend and AWAIT response
            return new Promise((resolve) => {
                chrome.runtime.sendMessage({
                    action: 'proxyFetch',
                    url: `${CONFIG.API.AI_SERVICE}/api/analytics/track`,
                    options: {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(payload)
                    }
                }, (response) => {
                    console.log('📊 Analytics Response:', response);
                    resolve(!!response?.success);
                });
            });

        } catch (e) {
            console.error('❌ Failed to submit analytics:', e);
            return false;
        }
    }
}
