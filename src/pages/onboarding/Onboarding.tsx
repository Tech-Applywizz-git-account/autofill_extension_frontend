import React, { useState, useEffect } from "react";
import { CanonicalProfile, EMPTY_PROFILE } from "../../types/canonicalProfile";
import { Gender, Race, YesNoDecline, SexualOrientation } from "../../types/canonicalEnums";
import { saveProfile, restoreProfile, restoreMasterData, loadProfile } from "../../core/storage/profileStorage";
import { patternStorage } from "../../core/storage/patternStorage";
import { mapMultiSourceToProfile, mapClientOnboardingToProfile, mapResumeParserToProfile } from "../../core/mapping/apiMapper";
import LandingPage from "./LandingPage";
import { CONFIG } from "../../config";
import "./Onboarding.css";

// Default profile data for Demo User - AML Analyst
const DEFAULT_PROFILE_DATA: Partial<CanonicalProfile> = {
    personal: {
        firstName: "Mahesh",
        lastName: "babu",
        email: "apply@gmail.com",
        phone: "+1 (123) 456-7890",
        city: "Malvern",
        state: "Pennsylvania",
        country: "United States",
        postalCode: "19355",
        linkedin: "https://linkedin.com/in/maheshbabu",
        github: ""
    },
    education: [
        {
            school: "State University of New York, Albany",
            degree: "Master of Science",
            major: "Data Science",
            startDate: "2022-08",
            endDate: "2024-05",
            gpa: "3.8",
            currentlyStudying: false
        },
        {
            school: "Sreenidhi Institute of Science & Technology",
            degree: "Bachelor of Science",
            major: "Computer Science",
            startDate: "2016-08",
            endDate: "2020-05",
            gpa: "3.5",
            currentlyStudying: false
        }
    ],
    experience: [
        {
            company: "MTX Group",
            title: "AML & Financial Crime Analyst",
            startDate: "2024-03",
            endDate: "",
            location: "Malvern, PA",
            currentlyWorking: true,
            jobType: "Full-time",
            bullets: [
                "Detected $15M+ laundering schemes including structuring, layering, and mule accounts",
                "Escalated 28% of alerts to SAR with improved detection precision by 40%",
                "Conducted KYC & EDD for MSBs, offshore trusts, and PEPs",
                "Achieved zero SAR rejections from FinCEN",
                "Reduced SAR turnaround time by 20%",
                "Improved sanctions name-matching efficiency",
                "Enhanced audit traceability by 35%",
                "Automated reviews using Python & Alteryx (25% workload reduction)"
            ]
        },
        {
            company: "Accenture",
            title: "KYC Analyst",
            startDate: "2019-09",
            endDate: "2022-06",
            location: "Hyderabad, India",
            currentlyWorking: false,
            jobType: "Full-time",
            bullets: [
                "End-to-end KYC onboarding for PEPs, offshore entities, and correspondent banks",
                "Improved sanctions match accuracy by 40%",
                "Performed transaction behavior analysis",
                "Streamlined onboarding workflows (30% time reduction)",
                "Supported AML model governance",
                "Managed PCR & remediation (98% completion rate)",
                "Drafted client risk assessment reports"
            ]
        }
    ],
    skills: [
        "Actimize",
        "SAS AML",
        "Oracle FCCM",
        "NICE Actimize CDD",
        "LexisNexis Bridger Insight",
        "World-Check",
        "Dow Jones Risk & Compliance",
        "BSA/AML",
        "KYC/CDD/EDD",
        "FATCA",
        "OFAC",
        "FinCEN",
        "Transaction Monitoring",
        "Sanctions Screening",
        "SAR Preparation",
        "SQL",
        "Python",
        "Excel",
        "Power BI",
        "Tableau",
        "Alteryx",
        "Data Analysis",
        "Risk Assessment",
        "Regulatory Compliance"
    ],
    workAuthorization: {
        authorizedUS: true,
        needsSponsorship: false,
        citizenshipStatus: "other_visa",
        driverLicense: true
    },
    eeo: {
        gender: Gender.MALE,
        race: Race.ASIAN,
        veteran: YesNoDecline.NO,
        disability: YesNoDecline.NO,
        hispanic: YesNoDecline.NO,
        lgbtq: YesNoDecline.DECLINE,
        sexualOrientation: "Asexual" as any // Updated to match actual form value
    },
    application: {
        previouslyApplied: false,
        previouslyEmployed: false,
        hasRelatives: false,
        governmentBackground: false
    }
};

const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            if (typeof reader.result === 'string') {
                resolve(reader.result);
            } else {
                reject(new Error("FileReader result is not a string"));
            }
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
};

const fetchAndParseResume = async (
    resumePath: string, 
    currentProfile: CanonicalProfile, 
    resumeUrlFromApi?: string,
    onStatusUpdate?: (status: string) => void
): Promise<CanonicalProfile> => {
    const s3BaseUrl = 'https://applywizz-prod.s3.us-east-2.amazonaws.com';
    const normalizedPath = resumePath.startsWith('/') ? resumePath : `/${resumePath}`;
    const resumeUrl = resumeUrlFromApi || `${s3BaseUrl}${normalizedPath}`;
    const fileName = resumePath.substring(resumePath.lastIndexOf('/') + 1) || "resume.pdf";

    if (onStatusUpdate) onStatusUpdate("Downloading resume from storage...");
    console.log(`[Onboarding] Fetching resume from URL: ${resumeUrl}`);
    const res = await fetch(resumeUrl);
    if (!res.ok) {
        throw new Error(`Failed to fetch resume from S3: ${res.statusText}`);
    }
    const blob = await res.blob();
    
    // Convert to base64 to store in documents.resume (as if uploaded manually)
    const base64 = await blobToBase64(blob);
    let updatedProfile: CanonicalProfile = {
        ...currentProfile,
        documents: {
            resume: {
                base64,
                fileName
            },
            coverLetter: currentProfile.documents?.coverLetter
        }
    };

    // Post to resume parser API
    if (onStatusUpdate) onStatusUpdate("Extracting skills and education from resume...");
    console.log(`[Onboarding] Uploading resume to parser API: ${CONFIG.API.RESUME_PARSER_API}`);
    const formData = new FormData();
    formData.append('file', blob, fileName);
    
    const parserRes = await fetch(CONFIG.API.RESUME_PARSER_API, {
        method: 'POST',
        body: formData
    });

    if (!parserRes.ok) {
        throw new Error(`Resume parser API failed with status ${parserRes.status}`);
    }

    const parserJson = await parserRes.json();
    console.log(`[Onboarding] Resume parser response:`, parserJson);
    
    // Map parsed data into profile
    if (onStatusUpdate) onStatusUpdate("Mapping and saving parsed details...");
    updatedProfile = mapResumeParserToProfile(parserJson, updatedProfile);
    return updatedProfile;
};

const fetchOnboardingDetailsFromApi = async (leadId: string): Promise<any> => {
    // Try local CRM first, then fallback to production Vercel
    const localUrl = `${CONFIG.API.BACKEND_URL}/api/client-onboarding-details?lead_id=${encodeURIComponent(leadId)}`;
    const prodUrl = `${CONFIG.API.CLIENT_ONBOARDING_API}?lead_id=${encodeURIComponent(leadId)}`;
    
    try {
        console.log(`[Onboarding] Trying to fetch client onboarding details from local CRM: ${localUrl}`);
        const response = await fetch(localUrl);
        if (response.ok) {
            const data = await response.json();
            if (data && data.success && data.data) {
                console.log("[Onboarding] Successfully fetched onboarding details from local CRM.");
                return data;
            }
        }
    } catch (err) {
        console.warn(`[Onboarding] Local CRM fetch failed, falling back to Vercel:`, err);
    }
    
    console.log(`[Onboarding] Fetching client onboarding details from Vercel CRM: ${prodUrl}`);
    const response = await fetch(prodUrl);
    if (!response.ok) {
        throw new Error(`Failed to fetch onboarding details from Vercel: ${response.status}`);
    }
    const data = await response.json();
    if (!data || !data.success) {
        throw new Error(data?.error || "Invalid response format from Vercel CRM");
    }
    return data;
};

const AuthPage: React.FC<{
    onSuccess: (email: string, token: string) => void;
}> = ({ onSuccess }) => {
    const [email, setEmail] = useState("");
    const [otp, setOtp] = useState("");
    const [otpSent, setOtpSent] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [statusMessage, setStatusMessage] = useState("");

    const validateEmail = (val: string) => {
        const trimmed = val.trim().toLowerCase();
        return trimmed.endsWith("@applywizz.com") || trimmed.endsWith("@applywizz.ai");
    };

    const handleSendOtp = async () => {
        setError("");
        setStatusMessage("");
        const trimmedEmail = email.trim().toLowerCase();

        if (!validateEmail(trimmedEmail)) {
            setError("Access denied: Email must end with @applywizz.com or @applywizz.ai");
            return;
        }

        setLoading(true);
        try {
            await new Promise<any>((resolve, reject) => {
                chrome.runtime.sendMessage({
                    action: 'proxyFetch',
                    url: `${CONFIG.API.AI_SERVICE}/api/auth/send-otp`,
                    options: {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ email: trimmedEmail })
                    }
                }, (response) => {
                    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                    else if (response && response.success) resolve(response.data);
                    else reject(new Error(response?.error || 'Failed to send OTP'));
                });
            });

            setOtpSent(true);
            setStatusMessage("Verification code sent to your email!");
        } catch (err: any) {
            console.error("Send OTP error:", err);
            setError(err.message || "Failed to send OTP. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    const handleVerifyOtp = async () => {
        setError("");
        setStatusMessage("");
        const trimmedEmail = email.trim().toLowerCase();
        const trimmedOtp = otp.trim();

        if (!trimmedOtp || trimmedOtp.length !== 6) {
            setError("Please enter a valid 6-digit verification code");
            return;
        }

        setLoading(true);
        try {
            const response = await new Promise<any>((resolve, reject) => {
                chrome.runtime.sendMessage({
                    action: 'proxyFetch',
                    url: `${CONFIG.API.AI_SERVICE}/api/auth/verify-otp`,
                    options: {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ email: trimmedEmail, otp: trimmedOtp })
                    }
                }, (response) => {
                    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                    else if (response && response.success) resolve(response.data);
                    else reject(new Error(response?.error || 'Invalid verification code'));
                });
            });

            if (response && response.token) {
                // Save to local storage
                await chrome.storage.local.set({
                    auth_token: response.token,
                    auth_email: trimmedEmail
                });
                onSuccess(trimmedEmail, response.token);
            } else {
                throw new Error("Invalid response structure from authentication server");
            }
        } catch (err: any) {
            console.error("Verify OTP error:", err);
            setError(err.message || "Verification failed. Please check your code.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="auth-page">
            <div className="auth-card">
                <div className="auth-header">
                    <img src="/assets/icon128.png" alt="Logo" className="auth-logo" />
                    <h1>ApplyWizz Portal</h1>
                    <p>Enter your professional email to authenticate</p>
                </div>

                {error && <div className="auth-alert error">⚠️ {error}</div>}
                {statusMessage && <div className="auth-alert success">✅ {statusMessage}</div>}

                <div className="auth-form">
                    <div className="form-field">
                        <label>Email Address</label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="username@applywizz.com"
                            disabled={loading || otpSent}
                            className="auth-input"
                        />
                        <span className="input-hint">Must end with @applywizz.com or @applywizz.ai</span>
                    </div>

                    {otpSent && (
                        <div className="form-field animation-slide-in">
                            <label>Verification Code (OTP)</label>
                            <input
                                type="text"
                                value={otp}
                                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").substring(0, 6))}
                                placeholder="Enter 6-digit OTP"
                                disabled={loading}
                                className="auth-input otp-input"
                                maxLength={6}
                            />
                        </div>
                    )}

                    {!otpSent ? (
                        <button
                            onClick={handleSendOtp}
                            disabled={loading || !email.trim()}
                            className="auth-btn"
                        >
                            {loading ? "Sending..." : "Send Verification Code"}
                        </button>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            <button
                                onClick={handleVerifyOtp}
                                disabled={loading || otp.length !== 6}
                                className="auth-btn success-btn"
                            >
                                {loading ? "Verifying..." : "Verify & Login"}
                            </button>
                            <button
                                onClick={() => {
                                    setOtpSent(false);
                                    setOtp("");
                                    setError("");
                                    setStatusMessage("");
                                }}
                                disabled={loading}
                                className="auth-btn link-btn"
                            >
                                Change Email
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const Onboarding: React.FC = () => {
    const [step, setStep] = useState(0); // 0 is Landing Page
    const [profile, setProfile] = useState<CanonicalProfile>(EMPTY_PROFILE);
    const [fetching, setFetching] = useState(false);
    const [fetchingStatus, setFetchingStatus] = useState("");
    const [apwId, setApwId] = useState("");
    const [authenticated, setAuthenticated] = useState(false);
    const [authEmail, setAuthEmail] = useState("");
    const [checkingAuth, setCheckingAuth] = useState(true);

    // Support Edit Mode and auto-fetch from lead_id/leadId
    useEffect(() => {
        const checkAuth = async () => {
            try {
                const stored = await chrome.storage.local.get(["auth_token", "auth_email"]);
                if (stored.auth_token && stored.auth_email) {
                    setAuthenticated(true);
                    setAuthEmail(stored.auth_email);
                }
            } catch (err) {
                console.error("Auth check failed:", err);
            } finally {
                setCheckingAuth(false);
            }
        };
        checkAuth();

        const urlParams = new URLSearchParams(window.location.search);
        const mode = urlParams.get('mode');
        const leadId = urlParams.get('lead_id') || urlParams.get('leadId');

        if (leadId) {
            const fetchOnboardingDetails = async () => {
                setFetching(true);
                setFetchingStatus("Connecting to CRM and loading details...");
                try {
                    console.log(`[Onboarding] Auto-fetching details for lead ID: ${leadId}`);
                    const resJson = await fetchOnboardingDetailsFromApi(leadId);
                    if (resJson && resJson.success && resJson.data) {
                        let mappedProfile = mapClientOnboardingToProfile(resJson.data, profile);
                        mappedProfile.metadata = {
                            ...mappedProfile.metadata,
                            apwId: leadId
                        };

                        if (resJson.data.resume_path) {
                            try {
                                console.log(`[Onboarding] Found resume_path: ${resJson.data.resume_path}. Starting fetch and parse...`);
                                mappedProfile = await fetchAndParseResume(resJson.data.resume_path, mappedProfile, resJson.data.resume_url, setFetchingStatus);
                                console.log("[Onboarding] Resume successfully fetched and parsed.");
                            } catch (parseErr: any) {
                                console.error("[Onboarding] Failed to fetch or parse resume from S3/Supabase:", parseErr);
                                alert(`Profile details loaded, but failed to fetch/parse resume: ${parseErr.message}`);
                            }
                        }

                        setProfile(mappedProfile);
                        await saveProfile(mappedProfile);
                        console.log("[Onboarding] Successfully loaded client onboarding details from URL query parameter");
                        setStep(1); // Go straight to step 1 (Personal Info) to let them view
                    }
                } catch (error: any) {
                    console.error("[Onboarding] Failed to auto-fetch onboarding details:", error);
                    alert(`Failed to load onboarding details for Lead ID ${leadId}: ${error.message}`);
                } finally {
                    setFetching(false);
                    setFetchingStatus("");
                }
            };
            fetchOnboardingDetails();
        } else if (mode === 'edit') {
            const loadExistingProfile = async () => {
                const existing = await loadProfile();
                if (existing) {
                    setProfile(existing);
                    setStep(1); // Jump straight to personal info
                }
            };
            loadExistingProfile();
        }
    }, []);

    const handleNewUser = () => {
        setStep(1);
    };

    const handleExistingUser = async (email: string) => {
        setFetching(true);
        try {
            const result = await restoreMasterData(email);
            if (result && result.profile) {
                setProfile(result.profile);
                alert("Welcome back! Your profile, patterns, and AI cache have been fully restored.");
                window.close(); // Close onboarding as they are already set up
            } else {
                alert("You are a new user. Please complete the onboarding form.");
                setStep(1);
            }
        } catch (error) {
            console.error("Restore error:", error);
            alert("Failed to restore data. Please try again or start as a new user.");
        } finally {
            setFetching(false);
        }
    };

    const handleApiFetch = async () => {
        if (!apwId.trim()) {
            alert("Please enter a valid ID");
            return;
        }

        const normalizedId = apwId.trim().toUpperCase();
        setApwId(normalizedId);

        setFetching(true);
        setFetchingStatus("Connecting to CRM and loading details...");
        try {
            // First try fetching from Client Onboarding Details API
            let isOnboardingSuccess = false;
            try {
                const onboardingJson = await fetchOnboardingDetailsFromApi(normalizedId);
                if (onboardingJson && onboardingJson.success && onboardingJson.data) {
                    let mappedProfile = mapClientOnboardingToProfile(onboardingJson.data, profile);
                    mappedProfile.metadata = {
                        ...mappedProfile.metadata,
                        apwId: normalizedId
                    };

                    if (onboardingJson.data.resume_path) {
                        try {
                            console.log(`[Onboarding] Found resume_path: ${onboardingJson.data.resume_path}. Starting fetch and parse...`);
                            mappedProfile = await fetchAndParseResume(onboardingJson.data.resume_path, mappedProfile, onboardingJson.data.resume_url, setFetchingStatus);
                            alert("Profile and resume successfully fetched and parsed!");
                        } catch (parseErr: any) {
                            console.error("[Onboarding] Failed to fetch or parse resume from S3/Supabase:", parseErr);
                            alert(`Profile details loaded, but failed to fetch/parse resume: ${parseErr.message}`);
                        }
                    } else {
                        alert("Profile successfully fetched from Client Onboarding Details!");
                    }

                    setProfile(mappedProfile);
                    await saveProfile(mappedProfile);
                    isOnboardingSuccess = true;
                }
            } catch (err) {
                console.warn("Client Onboarding API fetch failed, trying fallback sources:", err);
            }

            if (isOnboardingSuccess) {
                return;
            }

            // Fallback: Fetch from Local Lead Details API
            let localData = {};
            let isLocalSuccess = false;
            try {
                const backendUrl = CONFIG.API.BACKEND_URL;
                const localResponse = await fetch(`${backendUrl}/api/lead-details/${normalizedId}`);
                if (!localResponse.ok) {
                    console.warn(`Local API Error: ${localResponse.status}`);
                } else {
                    localData = await localResponse.json();
                    isLocalSuccess = true;
                }
            } catch (e) {
                console.warn("Local API unreachable, skipping:", e);
            }

            // Fallback: Fetch from Vercel Client Details API
            const vercelUrl = CONFIG.API.VERCEL_CRM;
            const vercelResponse = await fetch(`${vercelUrl}?applywizz_id=${normalizedId}`);
            if (!vercelResponse.ok) {
                console.warn(`Vercel API Error: ${vercelResponse.status}`);
            }
            const vercelData = vercelResponse.ok ? await vercelResponse.json() : {};

            if (!isLocalSuccess && !vercelResponse.ok) {
                throw new Error("Failed to fetch data from all sources.");
            }

            // Map multi-source data to profile
            const mappedProfile = mapMultiSourceToProfile(localData, vercelData, profile);

            // Set the apwId in metadata
            mappedProfile.metadata = {
                ...mappedProfile.metadata,
                apwId: normalizedId
            };

            setProfile(mappedProfile);
            await saveProfile(mappedProfile);
            alert("Profile successfully fetched from fallback API sources!");
        } catch (error) {
            console.error("API Fetch Error:", error);
            alert("Failed to fetch data from APIs. Please fill out manually.");
        } finally {
            setFetching(false);
            setFetchingStatus("");
        }
    };

    const handleSaveProfile = async () => {
        try {
            await saveProfile(profile);
            window.close();
        } catch (error) {
            alert("Failed to save profile");
        }
    };

    const updateProfile = (updates: Partial<CanonicalProfile>) => {
        setProfile({ ...profile, ...updates });
    };

    // Called by StepPersonal after resume parsing succeeds — replaces profile with enriched version
    const handleResumeParse = async (enrichedProfile: CanonicalProfile) => {
        setProfile(enrichedProfile);
        await saveProfile(enrichedProfile);
    };

    const totalSteps = 5;

    if (checkingAuth) {
        return (
            <div className="onboarding-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                <div className="fetching-loader">
                    <div className="spinner"></div>
                    <h3>Verifying session...</h3>
                </div>
            </div>
        );
    }

    if (!authenticated) {
        return <AuthPage onSuccess={(email, token) => {
            setAuthenticated(true);
            setAuthEmail(email);
        }} />;
    }

    return (
        <div className="onboarding-container">
            {fetching && (
                <div className="fetching-overlay">
                    <div className="fetching-loader">
                        <div className="spinner"></div>
                        <h3>{fetchingStatus || "Loading..."}</h3>
                        <p>Please wait while we retrieve your profile details and parse your resume.</p>
                    </div>
                </div>
            )}
            {step > 0 && (
                <div className="onboarding-progress">
                    <div className="progress-steps">
                        <div className={`progress-step ${step >= 1 ? "active" : ""}`}>1. Personal</div>
                        <div className={`progress-step ${step >= 2 ? "active" : ""}`}>2. Education</div>
                        <div className={`progress-step ${step >= 3 ? "active" : ""}`}>3. Work Experience</div>
                        <div className={`progress-step ${step >= 4 ? "active" : ""}`}>4. Skills</div>
                        <div className={`progress-step ${step >= 5 ? "active" : ""}`}>5. Equal Employment</div>
                    </div>
                    <div className="progress-bar">
                        <div className="progress-fill" style={{ width: `${(step / totalSteps) * 100}%` }} />
                    </div>
                </div>
            )}

            <div className="onboarding-content">
                {step === 0 && (
                    <LandingPage
                        onNewUser={handleNewUser}
                        onExistingUser={handleExistingUser}
                        loading={fetching}
                    />
                )}
                {step === 1 && (
                    <StepPersonal
                        profile={profile}
                        updateProfile={updateProfile}
                        apwId={apwId}
                        setApwId={setApwId}
                        onApiFetch={handleApiFetch}
                        onResumeParse={handleResumeParse}
                        fetching={fetching}
                        onNext={() => setStep(2)}
                        onBack={() => setStep(0)}
                    />
                )}
                {step === 2 && (
                    <StepEducation profile={profile} updateProfile={updateProfile} onNext={() => setStep(3)} onBack={() => setStep(1)} />
                )}
                {step === 3 && (
                    <StepExperience profile={profile} updateProfile={updateProfile} onNext={() => setStep(4)} onBack={() => setStep(2)} />
                )}
                {step === 4 && (
                    <StepSkills profile={profile} updateProfile={updateProfile} onNext={() => setStep(5)} onBack={() => setStep(3)} />
                )}
                {step === 5 && (
                    <StepEqualEmployment
                        profile={profile}
                        updateProfile={updateProfile}
                        onFinish={handleSaveProfile}
                        onBack={() => setStep(4)}
                        fetching={fetching}
                        setFetching={setFetching}
                    />
                )}
            </div>
        </div>
    );
};

// Step Components

const StepPersonal: React.FC<{
    profile: CanonicalProfile;
    updateProfile: (u: Partial<CanonicalProfile>) => void;
    apwId: string;
    setApwId: (id: string) => void;
    onApiFetch: () => void;
    onResumeParse: (updatedProfile: CanonicalProfile) => void;
    fetching: boolean;
    onNext: () => void;
    onBack: () => void;
}> = ({ profile, updateProfile, apwId, setApwId, onApiFetch, onResumeParse, fetching, onNext, onBack }) => {
    const [resumeParsing, setResumeParsing] = React.useState(false);
    const [parseStatus, setParseStatus] = React.useState<{ type: 'success' | 'error' | 'none'; message: string }>({ type: 'none', message: '' });

    const handlePrefill = () => {
        updateProfile(DEFAULT_PROFILE_DATA);
        alert("Profile prefilled with default AML Analyst data!");
    };
    const hasData = profile.personal.firstName || profile.personal.email || profile.metadata?.apiData;

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'resume' | 'coverLetter') => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (file.type !== "application/pdf") {
            alert("Please upload a PDF file");
            return;
        }

        // 1. Save the PDF as base64 for applications
        const reader = new FileReader();
        reader.onload = async (event) => {
            const base64 = event.target?.result as string;
            updateProfile({
                documents: {
                    ...profile.documents,
                    [type]: {
                        base64,
                        fileName: file.name
                    }
                }
            });
        };
        reader.readAsDataURL(file);

        // 2. If it's a resume, also parse it to extract education, skills, and experience
        if (type === 'resume') {
            setResumeParsing(true);
            setParseStatus({ type: 'none', message: '' });
            try {
                const formData = new FormData();
                formData.append('file', file);
                const parserUrl = CONFIG.API.RESUME_PARSER_API;
                const response = await fetch(parserUrl, {
                    method: 'POST',
                    body: formData
                });
                if (!response.ok) {
                    throw new Error(`Parser returned HTTP ${response.status}`);
                }
                const parserJson = await response.json();
                // Map parsed data into the current profile (skills, education, certifications)
                const enrichedProfile = mapResumeParserToProfile(parserJson, profile);
                onResumeParse(enrichedProfile);
                const skillCount = Array.isArray(parserJson.skills) ? parserJson.skills.length : 0;
                const eduCount = Array.isArray(parserJson.education_history) ? parserJson.education_history.length : 0;
                setParseStatus({
                    type: 'success',
                    message: `✅ Resume parsed! Found ${eduCount} education record(s) and ${skillCount} skill(s).`
                });
            } catch (err: any) {
                console.error('[Resume Parser] Failed:', err);
                setParseStatus({
                    type: 'error',
                    message: `⚠️ Resume parsing failed: ${err.message}. You can still fill details manually.`
                });
            } finally {
                setResumeParsing(false);
            }
        }
    };

    return (
        <div className="step">
            <button className="back-btn justify-end" onClick={onBack} style={{ flex: 1, background: '#f5f5f5', color: '#666', border: '1px solid #ddd', borderRadius: '8px', padding: '10px', cursor: 'pointer' }}>Back to Home</button>

            <div className="step-header">
                <h1>🎉 Great! Let's get started with your basic info.</h1>
            </div>

            <div className="step-header" style={{ marginTop: '10px', marginBottom: '20px', background: '#f0f4ff', padding: '15px', borderRadius: '12px', border: '1px solid #d0d7f7' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <h2 style={{ color: '#3f51b5', fontSize: '18px', margin: '0' }}>📄 Application Documents</h2>
                    <button
                        onClick={handlePrefill}
                        style={{
                            padding: '8px 16px',
                            background: '#4CAF50',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontSize: '13px',
                            fontWeight: '600',
                            transition: 'background 0.3s'
                        }}
                        onMouseOver={(e) => e.currentTarget.style.background = '#45a049'}
                        onMouseOut={(e) => e.currentTarget.style.background = '#4CAF50'}
                    >
                        ⚡ Prefill (Testing)
                    </button>
                </div>
                <p style={{ color: '#666', fontSize: '13px', margin: '0 0 15px 0' }}>Upload your latest Resume (PDF) to auto-fill education &amp; skills, and your Cover Letter for automated applications.</p>
                <div className="form-row" style={{ marginBottom: '0' }}>
                    <div className="form-field" style={{ marginBottom: '0' }}>
                        <label style={{ fontSize: '12px', fontWeight: '600' }}>Resume (PDF) — auto-parses skills &amp; education</label>
                        <div className="file-upload-wrapper">
                            <input
                                type="file"
                                accept=".pdf,application/pdf"
                                onChange={(e) => handleFileUpload(e, 'resume')}
                                id="resume-upload"
                                style={{ display: 'none' }}
                                disabled={resumeParsing}
                            />
                            <label htmlFor="resume-upload" className="file-upload-label" style={{ padding: '10px', fontSize: '13px', opacity: resumeParsing ? 0.6 : 1 }}>
                                {resumeParsing ? '⏳ Parsing resume...' : profile.documents?.resume ? `✅ ${profile.documents.resume.fileName}` : '📄 Upload Resume'}
                            </label>
                        </div>
                        {parseStatus.type !== 'none' && (
                            <p style={{
                                marginTop: '6px', fontSize: '12px',
                                color: parseStatus.type === 'success' ? '#2e7d32' : '#b71c1c',
                                background: parseStatus.type === 'success' ? '#f1f8e9' : '#ffebee',
                                padding: '6px 10px', borderRadius: '6px', lineHeight: '1.4'
                            }}>{parseStatus.message}</p>
                        )}
                    </div>
                    <div className="form-field" style={{ marginBottom: '0' }}>
                        <label style={{ fontSize: '12px', fontWeight: '600' }}>Cover Letter (PDF)</label>
                        <div className="file-upload-wrapper">
                            <input
                                type="file"
                                accept=".pdf,application/pdf"
                                onChange={(e) => handleFileUpload(e, 'coverLetter')}
                                id="coverletter-upload"
                                style={{ display: 'none' }}
                            />
                            <label htmlFor="coverletter-upload" className="file-upload-label" style={{ padding: '10px', fontSize: '13px' }}>
                                {profile.documents?.coverLetter ? `✅ ${profile.documents.coverLetter.fileName}` : "Upload Cover Letter"}
                            </label>
                        </div>
                    </div>
                </div>
            </div>

            {!hasData && (
                <div className="onboarding-source-options">
                    <div className="api-fetch-section">
                        <h3>Fetch from Portfolio ID / Lead ID</h3>
                        <div className="api-input-group">
                            <input
                                type="text"
                                value={apwId}
                                onChange={(e) => setApwId(e.target.value.toUpperCase())}
                                placeholder="e.g. AWL-1712 or Lead ID"
                                className="apw-id-input"
                            />
                            <button
                                onClick={onApiFetch}
                                disabled={fetching || !apwId}
                                className="api-fetch-btn"
                            >
                                {fetching ? "Fetching..." : "Fetch Data"}
                            </button>
                        </div>
                    </div>

                    <p className="or-divider">— OR —</p>
                    <p className="manual-info">Fill out your profile manually below</p>
                </div>
            )}

            <div className="form-row">
                <div className="form-field">
                    <label>* First Name</label>
                    <input type="text" value={profile.personal.firstName} onChange={(e) => updateProfile({ personal: { ...profile.personal, firstName: e.target.value } })} />
                </div>
                <div className="form-field">
                    <label>* Last Name</label>
                    <input type="text" value={profile.personal.lastName} onChange={(e) => updateProfile({ personal: { ...profile.personal, lastName: e.target.value } })} />
                </div>
            </div>

            <div className="form-field">
                <label>Preferred Name</label>
                <input type="text" value={profile.personal.preferredName || ""} onChange={(e) => updateProfile({ personal: { ...profile.personal, preferredName: e.target.value } })} placeholder="How should we call you?" />
            </div>

            <div className="form-row">
                <div className="form-field">
                    <label>* Email</label>
                    <input type="email" value={profile.personal.email} onChange={(e) => updateProfile({ personal: { ...profile.personal, email: e.target.value } })} />
                </div>
                <div className="form-field">
                    <label>* Phone</label>
                    <input type="tel" value={profile.personal.phone || ""} onChange={(e) => updateProfile({ personal: { ...profile.personal, phone: e.target.value } })} />
                </div>
            </div>

            <div className="form-row">
                <div className="form-field">
                    <label>City</label>
                    <input type="text" value={profile.personal.city || ""} onChange={(e) => updateProfile({ personal: { ...profile.personal, city: e.target.value } })} placeholder="San Francisco" />
                </div>
                <div className="form-field">
                    <label>State / Province</label>
                    <input type="text" value={profile.personal.state || ""} onChange={(e) => updateProfile({ personal: { ...profile.personal, state: e.target.value } })} placeholder="CA" />
                </div>
            </div>

            <div className="form-row">
                <div className="form-field">
                    <label>Country</label>
                    <input type="text" value={profile.personal.country || ""} onChange={(e) => updateProfile({ personal: { ...profile.personal, country: e.target.value } })} placeholder="United States" />
                </div>
                <div className="form-field">
                    <label>Postal Code</label>
                    <input type="text" value={profile.personal.postalCode || ""} onChange={(e) => updateProfile({ personal: { ...profile.personal, postalCode: e.target.value } })} />
                </div>
            </div>

            <div className="form-row">
                <div className="form-field">
                    <label>* LinkedIn URL</label>
                    <input type="url" value={profile.personal.linkedin || ""} onChange={(e) => updateProfile({ personal: { ...profile.personal, linkedin: e.target.value } })} placeholder="https://linkedin.com/in/yourprofile" />
                </div>
                <div className="form-field">
                    <label>Github URL</label>
                    <input type="url" value={profile.personal.github || ""} onChange={(e) => updateProfile({ personal: { ...profile.personal, github: e.target.value } })} placeholder="https://github.com/yourusername" />
                </div>
            </div>

            <div className="form-actions" style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                <button className="next-btn" onClick={onNext} style={{ flex: 2 }}>Next</button>
            </div>
        </div >
    );
};

const StepEducation: React.FC<{ profile: CanonicalProfile; updateProfile: (u: Partial<CanonicalProfile>) => void; onNext: () => void; onBack: () => void }> = ({ profile, updateProfile, onNext, onBack }) => {
    const addEducation = () => {
        updateProfile({
            education: [...profile.education, { school: "", degree: "", major: "", startDate: "", endDate: "", gpa: "" }]
        });
    };

    const removeEducation = (index: number) => {
        const updated = profile.education.filter((_, i) => i !== index);
        updateProfile({ education: updated });
    };

    const updateEducation = (index: number, field: string, value: string | boolean) => {
        const updated = [...profile.education];
        updated[index] = { ...updated[index], [field]: value };
        updateProfile({ education: updated });
    };

    return (
        <div className="step">
            <div className="step-header">
                <h1>📚 Next, please review and confirm your education history.</h1>
            </div>

            {profile.education.map((edu, idx) => (
                <div key={idx} className="entry-box">
                    <div className="entry-header">
                        <h3>Education {idx + 1}</h3>
                        {profile.education.length > 1 && (
                            <button className="remove-icon-btn" onClick={() => removeEducation(idx)}>🗑️</button>
                        )}
                    </div>

                    <div className="form-field">
                        <label>* School Name</label>
                        <input type="text" value={edu.school} onChange={(e) => updateEducation(idx, "school", e.target.value)} />
                    </div>

                    <div className="form-row">
                        <div className="form-field">
                            <label>* Major</label>
                            <input type="text" value={edu.major || ""} onChange={(e) => updateEducation(idx, "major", e.target.value)} placeholder="Computer Science" />
                        </div>
                        <div className="form-field">
                            <label>* Degree Type</label>
                            <select value={edu.degree} onChange={(e) => updateEducation(idx, "degree", e.target.value)}>
                                <option value="">Select...</option>
                                <option value="Bachelor of Science">Bachelor of Science</option>
                                <option value="Bachelor of Arts">Bachelor of Arts</option>
                                <option value="Master of Science">Master of Science</option>
                                <option value="Master of Arts">Master of Arts</option>
                                <option value="MBA">MBA</option>
                                <option value="PhD">PhD</option>
                                <option value="Associate">Associate</option>
                            </select>
                        </div>
                    </div>

                    <div className="form-row">
                        <div className="form-field">
                            <label>Start Date</label>
                            <input type="text" value={edu.startDate || ""} onChange={(e) => updateEducation(idx, "startDate", e.target.value)} placeholder="2023-01" />
                        </div>
                        <div className="form-field">
                            <label>End Date</label>
                            <input type="text" value={edu.endDate || ""} onChange={(e) => updateEducation(idx, "endDate", e.target.value)} placeholder="2024-12" />
                        </div>
                    </div>

                    <div className="form-field">
                        <label>
                            <input type="checkbox" checked={edu.currentlyStudying || false} onChange={(e) => updateEducation(idx, "currentlyStudying", e.target.checked)} />
                            I currently study here
                        </label>
                    </div>

                    <div className="form-field">
                        <label>GPA</label>
                        <input type="text" value={edu.gpa || ""} onChange={(e) => updateEducation(idx, "gpa", e.target.value)} placeholder="3.8" style={{ width: "100px" }} />
                    </div>
                </div>
            ))}

            <button className="add-btn" onClick={addEducation}>+ Add Education</button>

            <div className="button-row">
                <button onClick={onBack}>Back</button>
                <button className="next-btn" onClick={onNext}>Next</button>
            </div>
        </div>
    );
};

const StepExperience: React.FC<{ profile: CanonicalProfile; updateProfile: (u: Partial<CanonicalProfile>) => void; onNext: () => void; onBack: () => void }> = ({ profile, updateProfile, onNext, onBack }) => {
    const addExperience = () => {
        updateProfile({
            experience: [...profile.experience, { company: "", title: "", startDate: "", endDate: "", location: "", bullets: [] }]
        });
    };

    const removeExperience = (index: number) => {
        const updated = profile.experience.filter((_, i) => i !== index);
        updateProfile({ experience: updated });
    };

    const updateExperience = (index: number, field: string, value: string | string[] | boolean) => {
        const updated = [...profile.experience];
        updated[index] = { ...updated[index], [field]: value };
        updateProfile({ experience: updated });
    };

    return (
        <div className="step">
            <div className="step-header">
                <h1>🔍 Halfway there! Let's double-check your work experience.</h1>
            </div>

            {profile.experience.map((exp, idx) => (
                <div key={idx} className="entry-box">
                    <div className="entry-header">
                        <h3>Work Experience {idx + 1}</h3>
                        {profile.experience.length > 1 && (
                            <button className="remove-icon-btn" onClick={() => removeExperience(idx)}>🗑️</button>
                        )}
                    </div>

                    <div className="form-field">
                        <label>* Job Title</label>
                        <input type="text" value={exp.title} onChange={(e) => updateExperience(idx, "title", e.target.value)} />
                    </div>

                    <div className="form-field">
                        <label>* Company</label>
                        <input type="text" value={exp.company} onChange={(e) => updateExperience(idx, "company", e.target.value)} />
                    </div>

                    <div className="form-row">
                        <div className="form-field">
                            <label>* Job Type</label>
                            <select value={exp.jobType || ""} onChange={(e) => updateExperience(idx, "jobType", e.target.value)}>
                                <option value="">Select...</option>
                                <option value="Full-time">Full-time</option>
                                <option value="Part-time">Part-time</option>
                                <option value="Contract">Contract</option>
                                <option value="Internship">Internship</option>
                            </select>
                        </div>
                        <div className="form-field">
                            <label>Location</label>
                            <input type="text" value={exp.location || ""} onChange={(e) => updateExperience(idx, "location", e.target.value)} placeholder="Hyderabad, India" />
                        </div>
                    </div>

                    <div className="form-row">
                        <div className="form-field">
                            <label>Start Date</label>
                            <input type="text" value={exp.startDate || ""} onChange={(e) => updateExperience(idx, "startDate", e.target.value)} placeholder="2021-08" />
                        </div>
                        <div className="form-field">
                            <label>End Date</label>
                            <input type="text" value={exp.endDate || ""} onChange={(e) => updateExperience(idx, "endDate", e.target.value)} placeholder="2023-01" />
                        </div>
                    </div>

                    <div className="form-field">
                        <label>
                            <input type="checkbox" checked={exp.currentlyWorking || false} onChange={(e) => updateExperience(idx, "currentlyWorking", e.target.checked)} />
                            I currently work here
                        </label>
                    </div>

                    <div className="form-field">
                        <label>Responsibilities / Summary</label>
                        <textarea
                            value={exp.bullets?.join('\n') || ""}
                            onChange={(e) => updateExperience(idx, "bullets", e.target.value.split('\n'))}
                            rows={5}
                            placeholder="Describe your key achievements and responsibilities..."
                        />
                    </div>
                </div>
            ))}

            <button className="add-btn" onClick={addExperience}>+ Add Experience</button>

            <div className="button-row">
                <button onClick={onBack}>Back</button>
                <button className="next-btn" onClick={onNext}>Next</button>
            </div>
        </div>
    );
};

const StepSkills: React.FC<{ profile: CanonicalProfile; updateProfile: (u: Partial<CanonicalProfile>) => void; onNext: () => void; onBack: () => void }> = ({ profile, updateProfile, onNext, onBack }) => {
    const [skillInput, setSkillInput] = useState("");

    const addSkill = () => {
        if (skillInput.trim()) {
            updateProfile({ skills: [...profile.skills, skillInput.trim()] });
            setSkillInput("");
        }
    };

    const addMultipleSkills = () => {
        if (skillInput.trim()) {
            const newSkills = skillInput
                .split(',')
                .map(skill => skill.trim())
                .filter(skill => skill.length > 0);

            if (newSkills.length > 0) {
                updateProfile({ skills: [...profile.skills, ...newSkills] });
                setSkillInput("");
            }
        }
    };

    const removeSkill = (index: number) => {
        updateProfile({ skills: profile.skills.filter((_, i) => i !== index) });
    };

    return (
        <div className="step">
            <div className="step-header">
                <h1>💼 Add your skills</h1>
                <p style={{ color: '#666', fontSize: '14px', marginTop: '10px' }}>Enter skills separated by commas (e.g., "Python, SQL, Data Analysis") and click "Add Skills"</p>
            </div>

            <div className="skills-container">
                {profile.skills.map((skill, idx) => (
                    <div key={idx} className="skill-tag">
                        {skill}
                        <button className="skill-remove" onClick={() => removeSkill(idx)}>×</button>
                    </div>
                ))}
            </div>

            <div className="skill-input-row">
                <input
                    type="text"
                    value={skillInput}
                    onChange={(e) => setSkillInput(e.target.value)}
                    onKeyPress={(e) => e.key === "Enter" && addMultipleSkills()}
                    placeholder="Type skills (comma-separated) e.g. AI, ML, Java, Python, C"
                    style={{ flex: 1 }}
                />
                <button onClick={addMultipleSkills} style={{ marginLeft: '10px' }}>Add Skills</button>
            </div>

            <div className="button-row">
                <button onClick={onBack}>Back</button>
                <button className="next-btn" onClick={onNext}>Next</button>
            </div>
        </div>
    );
};

const StepEqualEmployment: React.FC<{
    profile: CanonicalProfile;
    updateProfile: (u: Partial<CanonicalProfile>) => void;
    onFinish: () => void;
    onBack: () => void;
    fetching: boolean;
    setFetching: (f: boolean) => void;
}> = ({ profile, updateProfile, onFinish, onBack, fetching, setFetching }) => {
    const [agreed, setAgreed] = useState(false);

    const handleFinish = async () => {
        if (!agreed) {
            alert("Please agree to the consent terms");
            return;
        }

        console.log("[Onboarding] 🏁 Finishing setup...");

        // Create final profile with consent fixed
        const finalProfile = {
            ...profile,
            consent: {
                agreedToAutofill: true,
                agreedAt: new Date().toISOString()
            }
        };

        try {
            setFetching(true);
            console.log("[Onboarding] 💾 Saving final profile...");
            await saveProfile(finalProfile);
            console.log("[Onboarding] ✅ Profile saved successfully");

            alert("Setup complete! Your profile is ready for autofill.");

            // Small delay to ensure storage write is flushed before window closes
            setTimeout(() => {
                window.close();
            }, 500);
        } catch (error) {
            console.error("[Onboarding] Save failed:", error);
            alert("Failed to save profile. Please try again.");
        } finally {
            setFetching(false);
        }
    };

    return (
        <div className="step">
            <div className="step-header">
                <h1>🎊 Last step! Share your equal employment info for a faster application process.</h1>
            </div>

            <div className="eeo-section">
                <div className="eeo-question">
                    <label>* Are You Authorized To Work In The US?</label>
                    <div className="radio-group">
                        <label><input type="radio" checked={profile.workAuthorization.authorizedUS === true} onChange={() => updateProfile({ workAuthorization: { ...profile.workAuthorization, authorizedUS: true } })} /> Yes</label>
                        <label><input type="radio" checked={profile.workAuthorization.authorizedUS === false} onChange={() => updateProfile({ workAuthorization: { ...profile.workAuthorization, authorizedUS: false } })} /> No</label>
                    </div>
                </div>

                <div className="eeo-question">
                    <label>* Will You Now Or In The Future Require Sponsorship For Employment Visa Status?</label>
                    <div className="radio-group">
                        <label><input type="radio" checked={profile.workAuthorization.needsSponsorship === true} onChange={() => updateProfile({ workAuthorization: { ...profile.workAuthorization, needsSponsorship: true } })} /> Yes</label>
                        <label><input type="radio" checked={profile.workAuthorization.needsSponsorship === false} onChange={() => updateProfile({ workAuthorization: { ...profile.workAuthorization, needsSponsorship: false } })} /> No</label>
                    </div>
                </div>

                <div className="eeo-question">
                    <label>* Citizenship / Export Control Status</label>
                    <select value={profile.workAuthorization.citizenshipStatus || ""} onChange={(e) => updateProfile({ workAuthorization: { ...profile.workAuthorization, citizenshipStatus: e.target.value } })}>
                        <option value="">Select...</option>
                        <option value="citizen">US Citizen or National</option>
                        <option value="permanent_resident">Permanent Resident (Green Card)</option>
                        <option value="refugee">Refugee</option>
                        <option value="asylee">Asylee</option>
                        <option value="other_visa">Other / None of the above</option>
                    </select>
                </div>

                <div className="eeo-question">
                    <label>Do You Have A Valid Driver's License?</label>
                    <div className="radio-group">
                        <label><input type="radio" checked={profile.workAuthorization.driverLicense === true} onChange={() => updateProfile({ workAuthorization: { ...profile.workAuthorization, driverLicense: true } })} /> Yes</label>
                        <label><input type="radio" checked={profile.workAuthorization.driverLicense === false} onChange={() => updateProfile({ workAuthorization: { ...profile.workAuthorization, driverLicense: false } })} /> No</label>
                    </div>
                </div>

                <div className="eeo-question">
                    <label>* Do You Have A Disability?</label>
                    <div className="radio-group">
                        <label><input type="radio" checked={profile.eeo.disability === YesNoDecline.YES} onChange={() => updateProfile({ eeo: { ...profile.eeo, disability: YesNoDecline.YES } })} /> Yes</label>
                        <label><input type="radio" checked={profile.eeo.disability === YesNoDecline.NO} onChange={() => updateProfile({ eeo: { ...profile.eeo, disability: YesNoDecline.NO } })} /> No</label>
                        <label><input type="radio" checked={profile.eeo.disability === YesNoDecline.DECLINE} onChange={() => updateProfile({ eeo: { ...profile.eeo, disability: YesNoDecline.DECLINE } })} /> Decline to state</label>
                    </div>
                </div>

                <div className="eeo-question">
                    <label>* Are You A Veteran?</label>
                    <div className="radio-group">
                        <label><input type="radio" checked={profile.eeo.veteran === YesNoDecline.YES} onChange={() => updateProfile({ eeo: { ...profile.eeo, veteran: YesNoDecline.YES } })} /> Yes</label>
                        <label><input type="radio" checked={profile.eeo.veteran === YesNoDecline.NO} onChange={() => updateProfile({ eeo: { ...profile.eeo, veteran: YesNoDecline.NO } })} /> No</label>
                        <label><input type="radio" checked={profile.eeo.veteran === YesNoDecline.DECLINE} onChange={() => updateProfile({ eeo: { ...profile.eeo, veteran: YesNoDecline.DECLINE } })} /> Decline to state</label>
                    </div>
                </div>

                <div className="eeo-question">
                    <label>* What Is Your Gender?</label>
                    <div className="radio-group">
                        <label><input type="radio" checked={profile.eeo.gender === Gender.MALE} onChange={() => updateProfile({ eeo: { ...profile.eeo, gender: Gender.MALE } })} /> Male</label>
                        <label><input type="radio" checked={profile.eeo.gender === Gender.FEMALE} onChange={() => updateProfile({ eeo: { ...profile.eeo, gender: Gender.FEMALE } })} /> Female</label>
                        <label><input type="radio" checked={profile.eeo.gender === Gender.NON_BINARY} onChange={() => updateProfile({ eeo: { ...profile.eeo, gender: Gender.NON_BINARY } })} /> Non-Binary</label>
                        <label><input type="radio" checked={profile.eeo.gender === Gender.DECLINE} onChange={() => updateProfile({ eeo: { ...profile.eeo, gender: Gender.DECLINE } })} /> Decline to state</label>
                    </div>
                </div>

                <div className="eeo-question">
                    <label>* Do You Identify As LGBTQ+?</label>
                    <div className="radio-group">
                        <label><input type="radio" checked={profile.eeo.lgbtq === YesNoDecline.YES} onChange={() => updateProfile({ eeo: { ...profile.eeo, lgbtq: YesNoDecline.YES } })} /> Yes</label>
                        <label><input type="radio" checked={profile.eeo.lgbtq === YesNoDecline.NO} onChange={() => updateProfile({ eeo: { ...profile.eeo, lgbtq: YesNoDecline.NO } })} /> No</label>
                        <label><input type="radio" checked={profile.eeo.lgbtq === YesNoDecline.DECLINE} onChange={() => updateProfile({ eeo: { ...profile.eeo, lgbtq: YesNoDecline.DECLINE } })} /> Decline to state</label>
                    </div>
                </div>

                <div className="eeo-question">
                    <label>* Are You Hispanic or Latino?</label>
                    <div className="radio-group">
                        <label><input type="radio" checked={profile.eeo.hispanic === YesNoDecline.YES} onChange={() => updateProfile({ eeo: { ...profile.eeo, hispanic: YesNoDecline.YES } })} /> Yes</label>
                        <label><input type="radio" checked={profile.eeo.hispanic === YesNoDecline.NO} onChange={() => updateProfile({ eeo: { ...profile.eeo, hispanic: YesNoDecline.NO } })} /> No</label>
                        <label><input type="radio" checked={profile.eeo.hispanic === YesNoDecline.DECLINE} onChange={() => updateProfile({ eeo: { ...profile.eeo, hispanic: YesNoDecline.DECLINE } })} /> Decline to state</label>
                    </div>
                </div>

                <div className="eeo-question">
                    <label>* How would you identify your race?</label>
                    <select value={profile.eeo.race} onChange={(e) => updateProfile({ eeo: { ...profile.eeo, race: e.target.value as Race } })}>
                        <option value={Race.DECLINE}>Decline to state</option>
                        <option value={Race.ASIAN}>Asian</option>
                        <option value={Race.SOUTH_ASIAN}>South Asian</option>
                        <option value={Race.BLACK}>Black or African American</option>
                        <option value={Race.HISPANIC}>Hispanic or Latino</option>
                        <option value={Race.WHITE}>White</option>
                        <option value={Race.AMERICAN_INDIAN}>American Indian or Alaska Native</option>
                        <option value={Race.PACIFIC_ISLANDER}>Native Hawaiian or Other Pacific Islander</option>
                        <option value={Race.TWO_OR_MORE}>Two or More Races</option>
                    </select>
                </div>

                <div className="step-header" style={{ marginTop: '20px' }}>
                    <h2>📋 Common Application Questions</h2>
                </div>

                <div className="eeo-question">
                    <label>Have you previously applied to this company?</label>
                    <div className="radio-group">
                        <label><input type="radio" checked={profile.application?.previouslyApplied === true} onChange={() => updateProfile({ application: { ...profile.application, previouslyApplied: true } })} /> Yes</label>
                        <label><input type="radio" checked={profile.application?.previouslyApplied === false} onChange={() => updateProfile({ application: { ...profile.application, previouslyApplied: false } })} /> No</label>
                    </div>
                </div>

                <div className="eeo-question">
                    <label>Have you previously been employed by this company?</label>
                    <div className="radio-group">
                        <label><input type="radio" checked={profile.application?.previouslyEmployed === true} onChange={() => updateProfile({ application: { ...profile.application, previouslyEmployed: true } })} /> Yes</label>
                        <label><input type="radio" checked={profile.application?.previouslyEmployed === false} onChange={() => updateProfile({ application: { ...profile.application, previouslyEmployed: false } })} /> No</label>
                    </div>
                </div>

                <div className="eeo-question">
                    <label>Do you have any relatives working at this company?</label>
                    <div className="radio-group">
                        <label><input type="radio" checked={profile.application?.hasRelatives === true} onChange={() => updateProfile({ application: { ...profile.application, hasRelatives: true } })} /> Yes</label>
                        <label><input type="radio" checked={profile.application?.hasRelatives === false} onChange={() => updateProfile({ application: { ...profile.application, hasRelatives: false } })} /> No</label>
                    </div>
                </div>

                <div className="eeo-question">
                    <label>Do you have a background in government or public office?</label>
                    <div className="radio-group">
                        <label><input type="radio" checked={profile.application?.governmentBackground === true} onChange={() => updateProfile({ application: { ...profile.application, governmentBackground: true } })} /> Yes</label>
                        <label><input type="radio" checked={profile.application?.governmentBackground === false} onChange={() => updateProfile({ application: { ...profile.application, governmentBackground: false } })} /> No</label>
                    </div>
                </div>

                <div className="eeo-question">
                    <label>* How would you describe your sexual orientation?</label>
                    <select value={profile.eeo.sexualOrientation} onChange={(e) => updateProfile({ eeo: { ...profile.eeo, sexualOrientation: e.target.value as SexualOrientation } })}>
                        <option value={SexualOrientation.DECLINE}>Decline to state</option>
                        <option value={SexualOrientation.HETEROSEXUAL}>Heterosexual</option>
                        <option value={SexualOrientation.GAY}>Gay</option>
                        <option value={SexualOrientation.LESBIAN}>Lesbian</option>
                        <option value={SexualOrientation.BISEXUAL}>Bisexual</option>
                        <option value={SexualOrientation.PANSEXUAL}>Pansexual</option>
                        <option value={SexualOrientation.ASEXUAL}>Asexual</option>
                        <option value={SexualOrientation.QUEER}>Queer</option>
                        <option value={SexualOrientation.QUESTIONING}>Questioning</option>
                        <option value={SexualOrientation.NOT_LISTED}>Not Listed</option>
                    </select>
                </div>
            </div>

            <div className="consent-section">
                <label className="consent-checkbox">
                    <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                    I agree to autofill job applications using my profile data
                </label>
            </div>

            <div className="button-row">
                <button onClick={onBack}>Back</button>
                <button className="finish-btn" onClick={handleFinish}>Finish Setup</button>
            </div>
        </div>
    );
};

export default Onboarding;
