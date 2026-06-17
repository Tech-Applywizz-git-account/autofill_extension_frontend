import { CanonicalProfile } from "../../types/canonicalProfile";
import { Gender, Race, YesNoDecline, SexualOrientation } from "../../types/canonicalEnums";

/**
 * Maps multi-source API responses to CanonicalProfile.
 * Source 1 (Local): lead-details (education, experience, location, phone, email, skills)
 * Source 2 (Vercel): get-client-details (everything else: EEO, Work Auth, etc.)
 */
export function mapMultiSourceToProfile(
    localData: { lead?: any; extractedData?: any[] },
    vercelData: { client?: any; additional_information?: any },
    currentProfile: CanonicalProfile
): CanonicalProfile {
    const profile: CanonicalProfile = JSON.parse(JSON.stringify(currentProfile));
    profile.apiFields = profile.apiFields || {};

    const localExtracted = localData.extractedData?.[0] || {};
    const localLead = localData.lead || {};
    const client = vercelData.client || {};
    const info = vercelData.additional_information || {};

    // --- 1. POPULATE RAW API FIELDS (for direct resolution) ---
    // Flatten all sources into apiFields
    const allFields = {
        ...localLead,
        ...localExtracted,
        ...client,
        ...info
    };

    Object.entries(allFields).forEach(([key, val]) => {
        if (val !== undefined && val !== null) {
            profile.apiFields![key] = val;
        }
    });

    // Handle special case: work_auth_details string
    if (client.work_auth_details) {
        const authStr = client.work_auth_details as string;
        profile.apiFields!.over18 = authStr.includes("Over 18: yes");
        profile.apiFields!.eligibleUS = authStr.includes("Eligible in US: yes");
        profile.apiFields!.authWithoutVisa = authStr.includes("Authorized w/o Visa: yes");
        profile.apiFields!.needsSponsorship = authStr.includes("Needs Sponsorship: yes");
    }

    // --- 2. MAP TO CANONICAL FIELDS ---

    // Personal Info (Local takes priority for contact, Client for name)
    profile.personal.email = localExtracted.email || localLead.email || client.personal_email || profile.personal.email;
    profile.personal.phone = localExtracted.phone || localLead.phone || info.primary_phone || profile.personal.phone;
    profile.personal.addressLine = localExtracted.location || localLead.location || info.full_address || profile.personal.addressLine;
    profile.personal.city = info.full_address || profile.personal.city;
    profile.personal.state = info.state_of_residence || profile.personal.state;
    profile.personal.postalCode = info.zip_or_country || profile.personal.postalCode;
    profile.personal.linkedin = info.linked_in_url || localExtracted.linkedInUrl || profile.personal.linkedin;
    profile.personal.github = info.github_url || profile.personal.github;

    const fullName = (localExtracted.fullName || client.full_name || "").trim();
    if (fullName) {
        const parts = fullName.split(/\s+/);
        if (parts.length >= 2) {
            profile.personal.firstName = parts[0];
            profile.personal.lastName = parts.slice(1).join(" ");
        } else if (parts.length === 1) {
            profile.personal.firstName = parts[0];
        }
    }

    // Education (Local takes priority)
    if (localExtracted.education) {
        let eduData = localExtracted.education;
        if (typeof eduData === 'string' && eduData.trim().startsWith('[')) {
            try { eduData = JSON.parse(eduData); } catch (e) { console.error("EDU Parse Error", e); }
        }
        if (Array.isArray(eduData)) {
            profile.education = eduData.map((e: any) => {
                let startDate = "", endDate = "";
                if (e.year) {
                    const years = e.year.split(/[-\u2013\u2014]/).map((s: string) => s.trim());
                    startDate = years[0] || "";
                    endDate = years[1] || "";
                }
                return {
                    school: e.institution || e.school || "",
                    degree: e.degree || "",
                    startDate,
                    endDate,
                    gpa: e.GPA || e.gpa || "",
                    currentlyStudying: endDate.toLowerCase().includes("present")
                };
            });
        }
    }

    // Experience (Local takes priority)
    if (localExtracted.workExperience) {
        let workData = localExtracted.workExperience;
        if (typeof workData === 'string' && workData.trim().startsWith('[')) {
            try { workData = JSON.parse(workData); } catch (e) { console.error("Work Parse Error", e); }
        }
        if (Array.isArray(workData)) {
            profile.experience = workData.map((w: any) => {
                let startDate = "", endDate = "";
                if (w.duration) {
                    const dates = w.duration.split(/[-\u2013\u2014]/).map((s: string) => s.trim());
                    startDate = dates[0] || "";
                    endDate = dates[1] || "";
                }
                return {
                    title: w.position || w.title || w.role || "",
                    company: w.company || "",
                    startDate,
                    endDate,
                    currentlyWorking: endDate.toLowerCase().includes("present"),
                    bullets: w.responsibilities ? [w.responsibilities] : []
                };
            });
        }
    }

    // Skills (Local takes priority)
    if (localExtracted.skills) {
        const skillsStr = localExtracted.skills as string;
        // Split by both commas and colons
        const skillParts = skillsStr.split(/[,:]+/).map(s => s.trim()).filter(Boolean);

        const headersToIgnore = [
            "analytics & modeling", "programming & tools", "professional soft skills",
            "data analytics & modeling", "soft skills", "technical skills", "key skills"
        ];

        const cleanedSkills = skillParts.filter(s => {
            const lowerS = s.toLowerCase();
            if (headersToIgnore.includes(lowerS)) return false;
            if (s.length > 50) return false;
            return true;
        });

        profile.skills = Array.from(new Set([...profile.skills, ...cleanedSkills]));
    }

    // Helper for boolean strings
    const isYes = (val: any) => val === true || (typeof val === 'string' && val.toLowerCase() === 'yes');

    // Work Authorization (Vercel Info)
    profile.workAuthorization.authorizedUS = isYes(info.eligible_to_work_in_us);
    profile.workAuthorization.needsSponsorship = isYes(info.require_future_sponsorship);
    profile.workAuthorization.driverLicense = isYes(info.has_valid_driver_license);
    profile.preferences.willingToRelocate = isYes(info.willing_to_relocate);

    // EEO Mapping (Vercel Info)
    if (info.gender) {
        const g = info.gender.toLowerCase();
        if (g.includes("male") && !g.includes("female")) profile.eeo.gender = Gender.MALE;
        else if (g.includes("female")) profile.eeo.gender = Gender.FEMALE;
        else profile.eeo.gender = Gender.DECLINE;
    }

    if (info.is_hispanic_latino) {
        const h = info.is_hispanic_latino.toLowerCase();
        profile.eeo.hispanic = h === "yes" ? YesNoDecline.YES : (h === "no" ? YesNoDecline.NO : YesNoDecline.DECLINE);
    }

    if (info.race_ethnicity) {
        const r = info.race_ethnicity.toLowerCase();
        if (r.includes("asian")) profile.eeo.race = Race.ASIAN;
        else if (r.includes("black")) profile.eeo.race = Race.BLACK;
        else if (r.includes("white")) profile.eeo.race = Race.WHITE;
        else if (r.includes("hispanic")) profile.eeo.race = Race.HISPANIC;
        else profile.eeo.race = Race.DECLINE;
    }

    if (info.disability_status) {
        const d = info.disability_status.toLowerCase();
        profile.eeo.disability = d.includes("yes") ? YesNoDecline.YES : (d.includes("no") ? YesNoDecline.NO : YesNoDecline.DECLINE);
    }

    if (info.veteran_status) {
        const v = info.veteran_status.toLowerCase();
        profile.eeo.veteran = (v.includes("am not") || v.includes("not a")) ? YesNoDecline.NO : YesNoDecline.YES;
    }

    // Application specific mappings
    profile.application = {
        previouslyEmployed: info.worked_for_company_before === true,
        governmentBackground: false,
        previouslyApplied: false,
        hasRelatives: info.has_relatives_in_company === true || info.has_relatives_in_company === "yes"
    };

    // Metadata
    profile.metadata = {
        ...profile.metadata,
        apiData: {
            lead: localLead,
            extractedData: localExtracted,
            vercelClient: client,
            vercelInfo: info,
            lastFetched: new Date().toISOString()
        }
    };

    return profile;
}

export function mapApiToProfile(apiResponse: { lead: any; extractedData: any[] }, currentProfile: CanonicalProfile): CanonicalProfile {
    return mapMultiSourceToProfile(apiResponse, {}, currentProfile);
}

export function mapClientOnboardingToProfile(
    clientOnboardingData: any,
    currentProfile: CanonicalProfile
): CanonicalProfile {
    const profile: CanonicalProfile = JSON.parse(JSON.stringify(currentProfile));
    profile.apiFields = profile.apiFields || {};

    const data = clientOnboardingData || {};

    // --- 1. POPULATE RAW API FIELDS (for direct resolution) ---
    Object.entries(data).forEach(([key, val]) => {
        if (val !== undefined && val !== null) {
            profile.apiFields![key] = val;
        }
    });

    // --- 2. MAP TO CANONICAL FIELDS ---

    // Personal Info
    profile.personal.email = data.company_email || profile.personal.email;
    profile.personal.phone = data.primary_phone || profile.personal.phone;
    profile.personal.addressLine = data.full_address || profile.personal.addressLine;
    profile.personal.city = data.city || profile.personal.city;
    profile.personal.state = data.state_of_residence || profile.personal.state;
    profile.personal.postalCode = data.zip_or_country || profile.personal.postalCode;
    profile.personal.linkedin = data.linkedin_url || profile.personal.linkedin;
    profile.personal.github = data.github_url || profile.personal.github;
    profile.personal.portfolio = data.portfolio_url || profile.personal.portfolio;

    // First and last names
    if (data.first_name) {
        profile.personal.firstName = data.first_name;
    }
    if (data.last_name) {
        profile.personal.lastName = data.last_name;
    }
    if (!data.first_name && !data.last_name && data.full_name) {
        const parts = data.full_name.trim().split(/\s+/);
        if (parts.length >= 2) {
            profile.personal.firstName = parts[0];
            profile.personal.lastName = parts.slice(1).join(" ");
        } else {
            profile.personal.firstName = parts[0];
        }
    }
    if (data.middle_name) {
        profile.personal.preferredName = data.middle_name;
    }

    // Education mapping
    if (data.university_name || data.highest_education) {
        profile.education = [
            {
                school: data.university_name || "",
                degree: data.highest_education || "",
                major: data.main_subject || "",
                startDate: "",
                endDate: data.graduation_year ? String(data.graduation_year) : "",
                gpa: data.cumulative_gpa ? String(data.cumulative_gpa) : "",
                currentlyStudying: false
            }
        ];
    }

    // Experience mapping
    let expList: any[] = [];
    const formatDate = (dateStr: any) => {
        if (typeof dateStr !== 'string') return "";
        const cleaned = dateStr.trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(cleaned)) {
            return cleaned.substring(0, 7); // convert YYYY-MM-DD to YYYY-MM
        }
        return cleaned;
    };

    if (data.employment_history) {
        let rawHistory = data.employment_history;
        if (typeof rawHistory === 'string') {
            try {
                rawHistory = JSON.parse(rawHistory);
            } catch (e) {
                console.error("Failed to parse employment_history string", e);
            }
        }
        if (Array.isArray(rawHistory)) {
            expList = rawHistory.map((item: any) => ({
                company: item.company_name || item.company || "",
                title: item.job_title || item.job_role || item.title || "",
                startDate: formatDate(item.start_date),
                endDate: formatDate(item.end_date),
                currentlyWorking: item.is_current === true || !item.end_date,
                location: item.location || "",
                jobType: item.job_type || "Full-time",
                bullets: Array.isArray(item.bullets) ? item.bullets : (item.bullets ? [item.bullets] : [])
            }));
        }
    }

    // Fallback if employment_history was empty or failed to parse
    if (expList.length === 0 && (data.recent_company_name || data.recent_job_title)) {
        expList = [
            {
                company: data.recent_company_name || "",
                title: data.recent_job_title || "",
                startDate: formatDate(data.employment_start_date),
                endDate: formatDate(data.employment_end_date),
                currentlyWorking: !data.employment_end_date,
                location: "",
                jobType: "Full-time",
                bullets: []
            }
        ];
    }

    if (expList.length > 0) {
        profile.experience = expList;
    }

    // Helper for boolean strings or raw booleans
    const isYes = (val: any) => val === true || (typeof val === 'string' && val.toLowerCase() === 'yes') || (typeof val === 'string' && val.toLowerCase() === 'true');

    // Work Authorization
    profile.workAuthorization.authorizedUS = isYes(data.eligible_to_work_in_us);
    profile.workAuthorization.needsSponsorship = isYes(data.require_future_sponsorship) || isYes(data.needs_sponsorship);
    profile.workAuthorization.driverLicense = isYes(data.has_valid_driver_license);
    profile.preferences.willingToRelocate = isYes(data.willing_to_relocate);

    // EEO Mapping
    if (data.gender) {
        const g = data.gender.toLowerCase();
        if (g.includes("male") && !g.includes("female")) profile.eeo.gender = Gender.MALE;
        else if (g.includes("female")) profile.eeo.gender = Gender.FEMALE;
        else if (g.includes("non_binary") || g.includes("non-binary")) profile.eeo.gender = Gender.NON_BINARY;
        else profile.eeo.gender = Gender.DECLINE;
    }

    if (data.is_hispanic_latino) {
        const h = String(data.is_hispanic_latino).toLowerCase();
        profile.eeo.hispanic = h.includes("yes") || h === "true" ? YesNoDecline.YES : (h.includes("no") || h === "false" ? YesNoDecline.NO : YesNoDecline.DECLINE);
    }

    if (data.race_ethnicity) {
        const r = data.race_ethnicity.toLowerCase();
        if (r.includes("asian")) profile.eeo.race = Race.ASIAN;
        else if (r.includes("black")) profile.eeo.race = Race.BLACK;
        else if (r.includes("white")) profile.eeo.race = Race.WHITE;
        else if (r.includes("hispanic")) profile.eeo.race = Race.HISPANIC;
        else profile.eeo.race = Race.DECLINE;
    }

    if (data.disability_status) {
        const d = String(data.disability_status).toLowerCase();
        profile.eeo.disability = d.includes("yes") || d.includes("disabled") || d === "true" ? YesNoDecline.YES : (d.includes("no") || d === "false" ? YesNoDecline.NO : YesNoDecline.DECLINE);
    }

    if (data.veteran_status) {
        const v = String(data.veteran_status).toLowerCase();
        profile.eeo.veteran = (v.includes("am not") || v.includes("not a") || v === "false" || v.includes("no")) ? YesNoDecline.NO : YesNoDecline.YES;
    }

    if (data.sexual_orientation) {
        const s = data.sexual_orientation.toLowerCase();
        if (s.includes("heterosexual") || s.includes("straight")) profile.eeo.sexualOrientation = SexualOrientation.HETEROSEXUAL;
        else if (s.includes("gay")) profile.eeo.sexualOrientation = SexualOrientation.GAY;
        else if (s.includes("lesbian")) profile.eeo.sexualOrientation = SexualOrientation.LESBIAN;
        else if (s.includes("bisexual")) profile.eeo.sexualOrientation = SexualOrientation.BISEXUAL;
        else if (s.includes("pansexual")) profile.eeo.sexualOrientation = SexualOrientation.PANSEXUAL;
        else if (s.includes("asexual")) profile.eeo.sexualOrientation = SexualOrientation.ASEXUAL;
        else if (s.includes("queer")) profile.eeo.sexualOrientation = SexualOrientation.QUEER;
        else profile.eeo.sexualOrientation = SexualOrientation.DECLINE;
    }

    // Application specific mappings
    profile.application = {
        ...profile.application,
        previouslyEmployed: isYes(data.worked_for_company_before),
        governmentBackground: false,
        previouslyApplied: false,
        hasRelatives: isYes(data.has_relatives_in_company)
    };

    // Metadata
    profile.metadata = {
        ...profile.metadata,
        apiData: {
            ...profile.metadata?.apiData,
            lead: data,
            extractedData: {},
            lastFetched: new Date().toISOString()
        }
    };

    return profile;
}

/**
 * Maps the response from resume-parser-without-ai.onrender.com/parse to CanonicalProfile.
 * Focused on: education_history, skills, certifications, employment_history, and personal contact info.
 */
export function mapResumeParserToProfile(
    parserData: any,
    currentProfile: CanonicalProfile
): CanonicalProfile {
    const profile: CanonicalProfile = JSON.parse(JSON.stringify(currentProfile));
    profile.apiFields = profile.apiFields || {};

    const data = parserData || {};

    // --- Personal Info (only fill if not already set from onboarding details) ---
    if (!profile.personal.firstName && data.first_name) {
        profile.personal.firstName = data.first_name;
    }
    if (!profile.personal.lastName && data.last_name) {
        profile.personal.lastName = data.last_name;
    }
    if (!profile.personal.email && data.personal_email) {
        profile.personal.email = data.personal_email;
    }
    if (!profile.personal.phone && data.primary_phone) {
        profile.personal.phone = data.primary_phone;
    }
    if (!profile.personal.linkedin && data.linkedin_url) {
        profile.personal.linkedin = data.linkedin_url;
    }
    if (!profile.personal.github && data.github_url) {
        profile.personal.github = data.github_url;
    }
    if (!profile.personal.portfolio && data.portfolio_url) {
        profile.personal.portfolio = data.portfolio_url;
    }

    // --- Education History ---
    if (Array.isArray(data.education_history) && data.education_history.length > 0) {
        profile.education = data.education_history.map((edu: any) => ({
            school: edu.institution || edu.university || edu.school || edu.college || "",
            degree: edu.degree || edu.qualification || "",
            major: edu.field_of_study || edu.major || edu.subject || "",
            startDate: edu.start_date || "",
            endDate: edu.end_date || edu.graduation_year ? String(edu.end_date || edu.graduation_year) : "",
            gpa: edu.gpa || edu.grade || "",
            currentlyStudying: !edu.end_date && !edu.graduation_year
        }));
    }

    // --- Employment History (from parser) ---
    // Only overwrite if we don't already have real employment data from client onboarding
    const hasOnboardingExp = profile.experience.length > 0 &&
        profile.experience.some(e => e.company && e.company.length > 0 && e.startDate);

    if (!hasOnboardingExp && Array.isArray(data.employment_history) && data.employment_history.length > 0) {
        // Filter out entries without a company or job title (parser sometimes generates noise rows)
        const cleanedHistory = data.employment_history.filter(
            (item: any) => item.company_name?.trim() || item.job_title?.trim()
        );
        if (cleanedHistory.length > 0) {
            profile.experience = cleanedHistory.map((item: any) => {
                let startDate = "";
                let endDate = "";
                // Parser returns dates like "01-06-2025 - Present" or "01-08-2022 - 01-12-2023"
                if (item.dates) {
                    const parts = item.dates.split(" - ").map((s: string) => s.trim());
                    const parsePartDate = (dateStr: string) => {
                        if (!dateStr || dateStr.toLowerCase() === "present") return "";
                        // DD-MM-YYYY → YYYY-MM
                        const match = dateStr.match(/^(\d{2})-(\d{2})-(\d{4})$/);
                        if (match) return `${match[3]}-${match[2]}`;
                        // YYYY-MM-DD → YYYY-MM
                        const iso = dateStr.match(/^(\d{4}-\d{2})/);
                        if (iso) return iso[1];
                        return dateStr;
                    };
                    startDate = parsePartDate(parts[0] || "");
                    endDate = parts[1] && parts[1].toLowerCase() !== "present" ? parsePartDate(parts[1]) : "";
                }
                return {
                    company: item.company_name || "",
                    title: item.job_title || "",
                    startDate,
                    endDate,
                    currentlyWorking: !item.dates || item.dates.toLowerCase().includes("present"),
                    location: item.location || "",
                    jobType: "Full-time",
                    bullets: item.description
                        ? item.description.split("•").map((s: string) => s.trim()).filter(Boolean)
                        : []
                };
            });
        }
    }

    // --- Skills ---
    if (Array.isArray(data.skills) && data.skills.length > 0) {
        const parsedSkills = data.skills
            .join(",")                               // combine into one string
            .split(/[,•\n]+/)                       // split on commas, bullets, newlines
            .map((s: string) => s.trim())
            .filter((s: string) => s.length > 0 && s.length <= 60); // ignore empty / overly long items

        const combined = Array.from(new Set([...profile.skills, ...parsedSkills]));
        profile.skills = combined;
    }

    // --- Certifications ---
    if (Array.isArray(data.certifications) && data.certifications.length > 0) {
        const parsedCerts = data.certifications
            .map((c: string) => c.replace(/^[•\-\s]+/, "").trim())
            .filter((c: string) => c.length > 0);
        profile.certifications = Array.from(new Set([
            ...(profile.certifications || []),
            ...parsedCerts
        ]));
    }

    return profile;
}
