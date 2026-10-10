"use client";

import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  Truck,
  Key,
  Search,
  Plus,
  Mic,
  MicOff,
  Upload,
  Camera,
  Image as ImageIcon,
  X,
  CheckCircle2,
  Clock,
  ArrowRight,
  Building2,
  Calendar,
  ShieldCheck,
  AlertCircle,
  Download,
  Sparkles,
  FileText,
  Check,
  RefreshCw,
  ClipboardList,
  MapPin,
  Phone,
  Mail,
  User,
  DollarSign,
  HelpCircle,
  Settings,
  Fuel,
  Scale,
  FileCheck,
  Eye,
  Send,
  Sliders,
  ChevronRight,
  AlertTriangle,
} from "lucide-react";
import AgentLayout from "@/components/agent-dashboard/AgentLayout";
import { logisticsConfig } from "@/components/agents/logistics/logisticsConfig";
import { useAuth } from "@/context/AuthContext";
import apiClient from "@/lib/api";

// Supported file formats for logistics documents
const SUPPORTED_DOCUMENT_EXTENSIONS = [
  "pdf",
  "docx",
  "xlsx",
  "csv",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "svg",
];

export interface VehicleListing {
  id: string;
  userId: string;
  companyName: string;
  category: string;
  type: string;
  registrationNumber: string;
  makeModel: string;
  modelYear: number;
  capacityTons: number;
  dimensions: string;
  fuelType: string;
  ownership: string;
  location: string;
  serviceArea: string;
  availableFrom: string;
  availableUntil: string;
  priceAmount: number;
  priceUnit: "per day" | "per trip" | "per km" | "per ton";
  driverAvailable: "With Driver" | "Without Driver" | "On Request";
  permittedUsage: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  notes: string;
  documents: {
    rcAttached: boolean;
    fitnessAttached: boolean;
    insuranceAttached: boolean;
    permitAttached: boolean;
  };
  status: "Active Listing" | "Dispatched" | "Under Maintenance";
  createdAt: string;
}

export interface VehicleRentalRequest {
  id: string;
  userId: string;
  companyName: string;
  vehicleId: string;
  vehicleTitle: string;
  vehicleReg: string;
  category: string;
  sourceLocation: string;
  destinationLocation: string;
  pickupDate: string;
  rentalDuration: string;
  offeredPrice: number;
  priceUnit: string;
  driverRequired: boolean;
  cargoType: string;
  instructions: string;
  status: "Request Submitted" | "Confirmed" | "In Transit" | "Completed";
  createdAt: string;
}

// Initial verified fleet pool available in major Indian logistics hubs
const INITIAL_FLEET_POOL: VehicleListing[] = [
  {
    id: "fleet-1",
    userId: "system-operator",
    companyName: "VRL Industrial Logistics",
    category: "Heavy Commercial Vehicle",
    type: "14-Ton Multi-Axle Rigid Truck",
    registrationNumber: "DL 01 AB 7890",
    makeModel: "Tata Prima 2830.K",
    modelYear: 2022,
    capacityTons: 14,
    dimensions: "24ft x 8ft x 8.5ft",
    fuelType: "Diesel",
    ownership: "Owned by Company",
    location: "Delhi-NCR",
    serviceArea: "All India Permit (National)",
    availableFrom: "2024-10-15",
    availableUntil: "2024-12-31",
    priceAmount: 8000,
    priceUnit: "per day",
    driverAvailable: "With Driver",
    permittedUsage: "General Industrial Goods, Steel, Machinery",
    contactName: "Rajesh Sharma",
    contactPhone: "+91 98110 23456",
    contactEmail: "fleet@vrl-industrial.com",
    notes: "GPS tracked, commercial e-way bill ready, verified driver.",
    documents: {
      rcAttached: true,
      fitnessAttached: true,
      insuranceAttached: true,
      permitAttached: true,
    },
    status: "Active Listing",
    createdAt: "2024-10-01",
  },
  {
    id: "fleet-2",
    userId: "system-operator",
    companyName: "Premier Heavy Haulage",
    category: "Heavy Commercial Vehicle",
    type: "10-Ton 6-Wheeler Closed Container",
    registrationNumber: "RJ 14 GA 4421",
    makeModel: "Ashok Leyland 4220",
    modelYear: 2023,
    capacityTons: 10,
    dimensions: "22ft x 7.5ft x 8ft",
    fuelType: "Diesel",
    ownership: "Authorized Logistics Operator",
    location: "Jaipur",
    serviceArea: "North India (Delhi, Jaipur, Chandigarh)",
    availableFrom: "2024-10-18",
    availableUntil: "2024-11-30",
    priceAmount: 6500,
    priceUnit: "per day",
    driverAvailable: "With Driver",
    permittedUsage: "Dry FMCG, Hardware, Automotive Parts",
    contactName: "Vikram Rathore",
    contactPhone: "+91 94140 88219",
    contactEmail: "dispatch@premierhaulage.in",
    notes: "Waterproof closed container with double lock security.",
    documents: {
      rcAttached: true,
      fitnessAttached: true,
      insuranceAttached: true,
      permitAttached: true,
    },
    status: "Active Listing",
    createdAt: "2024-10-03",
  },
  {
    id: "fleet-3",
    userId: "system-operator",
    companyName: "Maharashtra Freight Carriers",
    category: "Trailer / Flatbed",
    type: "25-Ton 40ft Multi-Axle Trailer",
    registrationNumber: "MH 12 QX 9081",
    makeModel: "BharatBenz 3528C",
    modelYear: 2021,
    capacityTons: 25,
    dimensions: "40ft x 8.5ft x 5ft",
    fuelType: "Diesel",
    ownership: "Owned by Company",
    location: "Mumbai",
    serviceArea: "All India Permit (National)",
    availableFrom: "2024-10-20",
    availableUntil: "2024-12-15",
    priceAmount: 14000,
    priceUnit: "per day",
    driverAvailable: "With Driver",
    permittedUsage: "Over-Dimensional Cargo, Structural Coils, Heavy Plant Machinery",
    contactName: "Anand Deshmukh",
    contactPhone: "+91 98220 54123",
    contactEmail: "ops@mfc-freight.com",
    notes: "High-strength flatbed with hydraulic twist-locks.",
    documents: {
      rcAttached: true,
      fitnessAttached: true,
      insuranceAttached: true,
      permitAttached: true,
    },
    status: "Active Listing",
    createdAt: "2024-10-05",
  },
  {
    id: "fleet-4",
    userId: "system-operator",
    companyName: "Gujarat Cold Chain Express",
    category: "Refrigerated Transport",
    type: "7-Ton Reefer Truck (-20°C to +15°C)",
    registrationNumber: "GJ 01 EZ 3319",
    makeModel: "Eicher Pro 6028",
    modelYear: 2023,
    capacityTons: 7,
    dimensions: "19ft x 7ft x 7ft",
    fuelType: "Diesel",
    ownership: "Owned by Company",
    location: "Ahmedabad",
    serviceArea: "Western & Central India",
    availableFrom: "2024-10-12",
    availableUntil: "2024-11-25",
    priceAmount: 7500,
    priceUnit: "per day",
    driverAvailable: "With Driver",
    permittedUsage: "Pharma, Chemicals, Dairy, Cold Chain Perishables",
    contactName: "Ketan Patel",
    contactPhone: "+91 98250 11984",
    contactEmail: "reefer@gujaratcoldchain.com",
    notes: "Continuous IoT temperature logger with live telemetry.",
    documents: {
      rcAttached: true,
      fitnessAttached: true,
      insuranceAttached: true,
      permitAttached: true,
    },
    status: "Active Listing",
    createdAt: "2024-10-06",
  },
];

interface AttachedDocument {
  name: string;
  size: string;
  type: string;
  source: "upload" | "camera" | "photo";
}

export default function LogisticsDashboard() {
  const { user } = useAuth();
  const currentUserId = user?.id || "guest-user";

  const [activeTab, setActiveTab] = useState<string>("dashboard");
  const [selectedOption, setSelectedOption] = useState<"lend" | "get">("lend");

  // Search & AI input state
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isPlusMenuOpen, setIsPlusMenuOpen] = useState<boolean>(false);
  const [menuPlacement, setMenuPlacement] = useState<"top" | "bottom">("top");
  const [isListening, setIsListening] = useState<boolean>(false);
  const [attachedFile, setAttachedFile] = useState<AttachedDocument | null>(null);

  // Toast feedback
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);

  // Camera modal state
  const [showCameraModal, setShowCameraModal] = useState<boolean>(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);

  // Persistence State
  const [lentVehicles, setLentVehicles] = useState<VehicleListing[]>([]);
  const [obtainedVehicles, setObtainedVehicles] = useState<VehicleRentalRequest[]>([]);
  const [selectedVehicleForRental, setSelectedVehicleForRental] = useState<VehicleListing | null>(null);

  // Search Results for "Get Vehicle"
  const [searchResults, setSearchResults] = useState<VehicleListing[] | null>(null);
  const [hasExecutedSearch, setHasExecutedSearch] = useState<boolean>(false);

  // Vehicle Details View Sub-tab
  const [vehicleDetailsSubTab, setVehicleDetailsSubTab] = useState<"lent" | "obtained">("lent");

  // Manual Vehicle-Listing Form State ("Lend Your Vehicle")
  const [lendForm, setLendForm] = useState({
    category: "Heavy Commercial Vehicle",
    type: "14-Ton Multi-Axle Rigid Truck",
    registrationNumber: "",
    makeModel: "",
    modelYear: 2022,
    capacityTons: 14,
    dimensions: "24ft x 8ft x 8.5ft",
    fuelType: "Diesel",
    ownership: "Owned by Company",
    location: "Delhi-NCR",
    serviceArea: "All India Permit (National)",
    availableFrom: new Date().toISOString().split("T")[0],
    availableUntil: new Date(Date.now() + 60 * 86400000).toISOString().split("T")[0],
    priceAmount: 8000,
    priceUnit: "per day" as "per day" | "per trip" | "per km" | "per ton",
    driverAvailable: "With Driver" as "With Driver" | "Without Driver" | "On Request",
    permittedUsage: "General Industrial Goods, Steel, Machinery",
    contactName: user?.name || "",
    contactPhone: "",
    contactEmail: user?.email || "",
    notes: "",
    rcAttached: true,
    fitnessAttached: true,
    insuranceAttached: true,
    permitAttached: false,
  });

  // Manual Vehicle-Search Form State ("Get Vehicle")
  const [getForm, setGetForm] = useState({
    category: "All Categories",
    minCapacityTons: 10,
    sourceLocation: "Delhi",
    destinationLocation: "Jaipur",
    pickupDate: new Date().toISOString().split("T")[0],
    rentalDuration: "1 Day",
    maxBudget: 15000,
    driverRequired: true,
    specialRequirements: "Closed Container, Waterproof",
    instructions: "",
  });

  // Rental Request Modal Form State
  const [rentalRequestForm, setRentalRequestForm] = useState({
    sourceLocation: "",
    destinationLocation: "",
    pickupDate: new Date().toISOString().split("T")[0],
    rentalDuration: "1 Day",
    offeredPrice: 0,
    driverRequired: true,
    cargoType: "Industrial Goods",
    instructions: "",
  });

  // Company Settings Form State
  const [settingsLoading, setSettingsLoading] = useState<boolean>(false);
  const [settingsSaving, setSettingsSaving] = useState<boolean>(false);
  const [settingsForm, setSettingsForm] = useState({
    businessName: "",
    contactPersonName: "",
    companyEmail: "",
    companyPhone: "",
    address: "",
    city: "",
    state: "",
    pincode: "",
    defaultDispatchHub: "Delhi-NCR",
    preferredVehicleClass: "Heavy Commercial Vehicle",
    nationalPermitRequired: true,
    dispatchAlerts: true,
    tripStatusUpdates: true,
    employerType: "",
    verificationStatus: "",
  });

  // Refs
  const plusMenuRef = useRef<HTMLDivElement>(null);
  const plusButtonRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const recognitionRef = useRef<any>(null);

  const showToast = (message: string, type: "success" | "error" | "info" = "info") => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 4500);
  };

  // Load user-scoped persistence for lent and obtained vehicles
  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        const savedLent = localStorage.getItem(`gleska_logistics_${currentUserId}_lent`);
        if (savedLent) {
          setLentVehicles(JSON.parse(savedLent));
        } else {
          setLentVehicles([]);
        }

        const savedObtained = localStorage.getItem(`gleska_logistics_${currentUserId}_obtained`);
        if (savedObtained) {
          setObtainedVehicles(JSON.parse(savedObtained));
        } else {
          setObtainedVehicles([]);
        }
      } catch (e) {
        console.error("Error loading logistics records from local storage", e);
      }
    }
  }, [currentUserId]);

  // Load backend Company Settings when settings tab is opened
  useEffect(() => {
    if (activeTab === "settings") {
      loadCompanySettings();
    }
  }, [activeTab]);

  const loadCompanySettings = async () => {
    setSettingsLoading(true);
    try {
      const meRes = await apiClient.get("/employers/me");
      const meData = meRes.data || {};
      const profile = meData.profile || {};
      const account = meData.account || {};
      const employer = meData.employer || {};

      let prefs = { job_matching_notifications: true, security_alerts: true };
      try {
        const prefRes = await apiClient.get("/employers/me/preferences");
        if (prefRes.data) {
          prefs = prefRes.data;
        }
      } catch (err) {
        // Preferences optional fallback
      }

      setSettingsForm((prev) => ({
        ...prev,
        businessName: profile.business_name || profile.company_name || employer.business_name || "",
        contactPersonName: employer.contact_person_name || account.name || user?.name || "",
        companyEmail: profile.company_email || account.email || user?.email || "",
        companyPhone: profile.company_phone || account.mobile || "",
        address: profile.address || profile.registered_address || "",
        city: profile.city || "",
        state: profile.state || "",
        pincode: profile.pincode || "",
        employerType: employer.employer_type || meData.employer_type || "",
        verificationStatus: employer.verification_status || meData.verification_status || "",
        dispatchAlerts: prefs.job_matching_notifications ?? true,
        tripStatusUpdates: prefs.security_alerts ?? true,
      }));
    } catch (err: any) {
      console.warn("Could not load backend employer profile:", err);
      // Fallback to current authenticated user object
      setSettingsForm((prev) => ({
        ...prev,
        contactPersonName: user?.name || "",
        companyEmail: user?.email || "",
      }));
    } finally {
      setSettingsLoading(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSettingsSaving(true);
    try {
      if (settingsForm.pincode && !/^[0-9]{6}$/.test(settingsForm.pincode)) {
        showToast("PIN code must be a valid 6-digit Indian postal code.", "error");
        setSettingsSaving(false);
        return;
      }

      // 1. Update company profile on backend
      const payload: Record<string, any> = {
        contact_person_name: settingsForm.contactPersonName || undefined,
        business_name: settingsForm.businessName || undefined,
        company_email: settingsForm.companyEmail ? settingsForm.companyEmail.toLowerCase() : undefined,
        company_phone: settingsForm.companyPhone || undefined,
        address: settingsForm.address || undefined,
        city: settingsForm.city || undefined,
        state: settingsForm.state || undefined,
        pincode: settingsForm.pincode || undefined,
      };

      await apiClient.put("/employers/company-profile", payload);

      // 2. Update preferences
      try {
        await apiClient.put("/employers/me/preferences", {
          job_matching_notifications: settingsForm.dispatchAlerts,
          security_alerts: settingsForm.tripStatusUpdates,
        });
      } catch (prefErr) {
        // Continue if preferences sub-call succeeds or fails
      }

      showToast("Company profile and logistics preferences saved to Gleska backend.", "success");
    } catch (err: any) {
      const msg = err.response?.data?.detail || err.message || "Failed to save company profile.";
      showToast(typeof msg === "string" ? msg : JSON.stringify(msg), "error");
    } finally {
      setSettingsSaving(false);
    }
  };

  // Close plus dropdown menu when clicking outside or pressing Escape
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (plusMenuRef.current && !plusMenuRef.current.contains(event.target as Node)) {
        setIsPlusMenuOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsPlusMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  // Sync camera stream to video tag
  useEffect(() => {
    if (showCameraModal && cameraStream && videoRef.current) {
      videoRef.current.srcObject = cameraStream;
      videoRef.current.play().catch(() => {});
    }
  }, [showCameraModal, cameraStream]);

  // Clean up streams and speech recognition on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch (e) {}
      }
      if (cameraStream) {
        cameraStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [cameraStream]);

  // Synchronize selector changes with tabs
  const handleSelectorChange = (optionId: "lend" | "get") => {
    setSelectedOption(optionId);
    if (optionId === "lend") {
      setActiveTab("lend");
    } else {
      setActiveTab("get");
    }
  };

  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId);
    if (tabId === "lend") {
      setSelectedOption("lend");
    } else if (tabId === "get") {
      setSelectedOption("get");
    }
  };

  // Smart placement for the plus menu
  const handleTogglePlusMenu = () => {
    if (!isPlusMenuOpen && plusButtonRef.current) {
      const rect = plusButtonRef.current.getBoundingClientRect();
      if (rect.top >= 160) {
        setMenuPlacement("top");
      } else {
        setMenuPlacement("bottom");
      }
    }
    setIsPlusMenuOpen((prev) => !prev);
  };

  // File Upload Handler
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const extension = file.name.split(".").pop()?.toLowerCase() || "";
    const isValid =
      SUPPORTED_DOCUMENT_EXTENSIONS.includes(extension) ||
      file.type.startsWith("image/") ||
      file.type === "application/pdf" ||
      file.type.includes("word") ||
      file.type.includes("sheet") ||
      file.type.includes("csv");

    if (!isValid) {
      showToast(
        "Invalid file format. Please select a valid document (PDF, DOCX, XLSX, CSV, or Image).",
        "error"
      );
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const sizeFormatted =
      file.size > 1024 * 1024
        ? `${(file.size / (1024 * 1024)).toFixed(2)} MB`
        : `${Math.round(file.size / 1024)} KB`;

    setAttachedFile({
      name: file.name,
      size: sizeFormatted,
      type: file.type || extension.toUpperCase(),
      source: "upload",
    });

    showToast(`Document attached: ${file.name} (${sizeFormatted})`, "success");
    setIsPlusMenuOpen(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Choose Photo Handler
  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      showToast("Invalid file. Please select an image photo.", "error");
      if (photoInputRef.current) photoInputRef.current.value = "";
      return;
    }

    const sizeFormatted = `${Math.round(file.size / 1024)} KB`;
    setAttachedFile({
      name: file.name,
      size: sizeFormatted,
      type: "Vehicle Photograph",
      source: "photo",
    });

    showToast(`Vehicle photo attached: ${file.name}`, "success");
    setIsPlusMenuOpen(false);
    if (photoInputRef.current) photoInputRef.current.value = "";
  };

  // Trigger Take Photo: Checks camera support & permissions
  const triggerTakePhoto = async () => {
    setIsPlusMenuOpen(false);

    if (
      typeof window !== "undefined" &&
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === "function"
    ) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        setCameraStream(stream);
        setShowCameraModal(true);
        return;
      } catch (err: any) {
        if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
          showToast(
            "Camera permission was denied. Please enable camera access in your browser settings.",
            "error"
          );
          return;
        } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
          showToast("No camera device found on this system. Opening file chooser.", "info");
          cameraInputRef.current?.click();
          return;
        }
        cameraInputRef.current?.click();
      }
    } else {
      cameraInputRef.current?.click();
    }
  };

  // Native camera fallback
  const handleCameraCaptureFallback = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const sizeFormatted = `${Math.round(file.size / 1024)} KB`;
    setAttachedFile({
      name: file.name || "Vehicle_Photo_Capture.jpg",
      size: sizeFormatted,
      type: "Camera Capture",
      source: "camera",
    });

    showToast("Vehicle photo captured successfully.", "success");
    if (cameraInputRef.current) cameraInputRef.current.value = "";
  };

  // Capture Frame from Live Camera Stream
  const capturePhotoFromStream = () => {
    if (!videoRef.current) return;
    try {
      const video = videoRef.current;
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const filename = `Vehicle_Capture_${new Date().toISOString().slice(0, 10)}_${Math.floor(Math.random() * 1000)}.jpg`;
        setAttachedFile({
          name: filename,
          size: "520 KB",
          type: "Camera Capture (HD)",
          source: "camera",
        });
        showToast("Vehicle photo captured from camera.", "success");
        closeCameraModal();
      }
    } catch (e) {
      showToast("Error capturing photo from camera.", "error");
      closeCameraModal();
    }
  };

  const closeCameraModal = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
      setCameraStream(null);
    }
    setShowCameraModal(false);
  };

  // Speech Recognition / Voice Input
  const toggleListening = () => {
    if (isListening) {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {}
      }
      setIsListening(false);
      return;
    }

    const SpeechRecognition =
      typeof window !== "undefined"
        ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : null;

    if (!SpeechRecognition) {
      showToast(
        "Speech recognition is not supported in this browser. Please use Chrome, Edge, or Safari, or enter text manually.",
        "error"
      );
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = "en-IN";

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event: any) => {
        let transcript = "";
        for (let i = 0; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        if (transcript) {
          setSearchQuery(transcript);
        }
      };

      recognition.onerror = (event: any) => {
        setIsListening(false);
        if (event.error === "not-allowed" || event.error === "permission-denied") {
          showToast(
            "Microphone permission denied. Please allow microphone access in your browser settings.",
            "error"
          );
        } else if (event.error === "no-speech") {
          showToast("No speech detected. Please speak again.", "info");
        } else if (event.error !== "aborted") {
          showToast(`Speech recognition issue: ${event.error}`, "error");
        }
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err: any) {
      setIsListening(false);
      showToast("Unable to start speech recognition. Check microphone settings.", "error");
    }
  };

  // AI Natural Language Extraction for Lend Your Vehicle
  const handleExtractLendQuery = () => {
    const text = searchQuery.trim();
    if (!text) {
      showToast("Please enter or dictate a natural language description to extract vehicle details.", "info");
      return;
    }

    // Smart natural language parsing
    const lower = text.toLowerCase();
    const newLend = { ...lendForm };

    // Capacity detection
    const tonMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:-| )?(?:ton|tonne|t|mt)/);
    if (tonMatch) {
      newLend.capacityTons = parseFloat(tonMatch[1]);
    }

    // Vehicle Category & Type detection
    if (lower.includes("trailer") || lower.includes("flatbed")) {
      newLend.category = "Trailer / Flatbed";
      newLend.type = newLend.capacityTons ? `${newLend.capacityTons}-Ton Flatbed Trailer` : "Flatbed Trailer";
    } else if (lower.includes("reefer") || lower.includes("refrigerat") || lower.includes("cold")) {
      newLend.category = "Refrigerated Transport";
      newLend.type = "Reefer Temperature-Controlled Truck";
    } else if (lower.includes("container")) {
      newLend.category = "Heavy Commercial Vehicle";
      newLend.type = "Closed Container Truck";
    } else if (lower.includes("pickup") || lower.includes("bolero") || lower.includes("dost")) {
      newLend.category = "Light Commercial Vehicle";
      newLend.type = "1.5-Ton Commercial Pickup";
      if (!tonMatch) newLend.capacityTons = 1.5;
    } else if (lower.includes("truck") || lower.includes("lorry")) {
      newLend.category = "Heavy Commercial Vehicle";
      newLend.type = newLend.capacityTons ? `${newLend.capacityTons}-Ton Commercial Truck` : "Heavy Commercial Truck";
    }

    // Location detection (standard Indian transport hubs)
    const cities = ["Delhi", "Jaipur", "Mumbai", "Pune", "Ahmedabad", "Surat", "Bengaluru", "Chennai", "Kolkata", "Hyderabad", "Chandigarh", "Lucknow", "Indore", "Nagpur"];
    for (const city of cities) {
      if (lower.includes(city.toLowerCase())) {
        newLend.location = city;
        break;
      }
    }

    // Price detection
    const priceMatch = lower.match(/(?:₹|rs\.?|inr)?\s*(\d{1,3}(?:,\d{3})+|\d+)\s*(?:per|\/)?\s*(day|trip|km|ton)?/);
    if (priceMatch) {
      const num = parseInt(priceMatch[1].replace(/,/g, ""), 10);
      if (!isNaN(num) && num > 100) {
        newLend.priceAmount = num;
        if (priceMatch[2]) {
          const unit = priceMatch[2].toLowerCase();
          if (unit === "day") newLend.priceUnit = "per day";
          else if (unit === "trip") newLend.priceUnit = "per trip";
          else if (unit === "km") newLend.priceUnit = "per km";
          else if (unit === "ton") newLend.priceUnit = "per ton";
        }
      }
    }

    // Date detection
    const dateMatch = lower.match(/(?:from|on|available|starting)\s*(\d{1,2}(?:st|nd|rd|th)?\s+[a-z]+|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/);
    if (dateMatch) {
      // Set to upcoming date
      const futureDate = new Date(Date.now() + 10 * 86400000).toISOString().split("T")[0];
      newLend.availableFrom = futureDate;
    }

    setLendForm(newLend);
    showToast("AI parsed your vehicle listing details. Please review the populated fields below.", "success");
  };

  // AI Natural Language Extraction for Get Vehicle
  const handleExtractGetQuery = () => {
    const text = searchQuery.trim();
    if (!text) {
      showToast("Please enter or dictate your transport requirement to search available fleet.", "info");
      return;
    }

    const lower = text.toLowerCase();
    const newGet = { ...getForm };

    // Capacity detection
    const tonMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:-| )?(?:ton|tonne|t|mt)/);
    if (tonMatch) {
      newGet.minCapacityTons = parseFloat(tonMatch[1]);
    }

    // Route detection ("from X to Y")
    const routeMatch = lower.match(/from\s+([a-zA-Z\s]+?)\s+to\s+([a-zA-Z\s]+?)(?:\s+on|\s+with|\s+for|$|,)/);
    if (routeMatch) {
      newGet.sourceLocation = routeMatch[1].trim();
      newGet.destinationLocation = routeMatch[2].trim();
    } else {
      const cities = ["Delhi", "Jaipur", "Mumbai", "Pune", "Ahmedabad", "Surat", "Bengaluru", "Chennai", "Kolkata", "Hyderabad", "Chandigarh"];
      for (const city of cities) {
        if (lower.includes(city.toLowerCase()) && !newGet.sourceLocation) {
          newGet.sourceLocation = city;
        }
      }
    }

    // Budget detection
    const budgetMatch = lower.match(/(?:budget|for|max|rate)?\s*(?:₹|rs\.?|inr)?\s*(\d{1,3}(?:,\d{3})+|\d+)/);
    if (budgetMatch) {
      const num = parseInt(budgetMatch[1].replace(/,/g, ""), 10);
      if (!isNaN(num) && num >= 500) {
        newGet.maxBudget = num;
      }
    }

    setGetForm(newGet);
    showToast("AI extracted route and budget criteria. Executing matching against fleet pool...", "success");

    // Execute matching against actual available vehicles
    executeFleetSearch(newGet);
  };

  // Execute Search for "Get Vehicle"
  const executeFleetSearch = (criteria = getForm) => {
    setHasExecutedSearch(true);

    // Combine system pool with user's own lent vehicles
    const allPool = [...lentVehicles, ...INITIAL_FLEET_POOL];

    const matched = allPool.filter((v) => {
      // 1. Capacity criteria
      if (criteria.minCapacityTons && v.capacityTons < criteria.minCapacityTons) {
        return false;
      }
      // 2. Budget criteria (if daily rate <= maxBudget or reasonable trip match)
      if (criteria.maxBudget && v.priceAmount > criteria.maxBudget) {
        return false;
      }
      // 3. Location match (check source location in vehicle base or service area)
      if (criteria.sourceLocation) {
        const src = criteria.sourceLocation.toLowerCase();
        const vLoc = v.location.toLowerCase();
        const vArea = v.serviceArea.toLowerCase();
        const matchesLocation =
          vLoc.includes(src) ||
          vArea.includes(src) ||
          vArea.includes("all india") ||
          vArea.includes("national");
        if (!matchesLocation) {
          return false;
        }
      }
      return true;
    });

    setSearchResults(matched);
  };

  // Handle Submit of Manual Vehicle Listing Form ("Lend Your Vehicle")
  const handleSaveVehicleListing = (e: React.FormEvent) => {
    e.preventDefault();

    // Authoritative Indian compliance checks
    if (!lendForm.registrationNumber.trim()) {
      showToast("Vehicle Registration Number (e.g. DL 01 AB 1234) is required.", "error");
      return;
    }
    if (!lendForm.makeModel.trim()) {
      showToast("Vehicle Make & Model (e.g. Tata Prima, Ashok Leyland) is required.", "error");
      return;
    }
    if (!lendForm.location.trim()) {
      showToast("Current Base Location / Hub is required.", "error");
      return;
    }
    if (!lendForm.priceAmount || lendForm.priceAmount <= 0) {
      showToast("Please enter a valid rental price amount.", "error");
      return;
    }
    if (!lendForm.rcAttached) {
      showToast("Under Indian Motor Vehicles Act, a valid Registration Certificate (RC) confirmation is required for commercial listing.", "error");
      return;
    }
    if (!lendForm.fitnessAttached) {
      showToast("Valid Commercial Fitness Certificate confirmation is required for heavy dispatch vehicles.", "error");
      return;
    }

    const newVehicle: VehicleListing = {
      id: `veh-${Date.now()}`,
      userId: currentUserId,
      companyName: settingsForm.businessName || user?.name || "Verified Fleet Partner",
      category: lendForm.category,
      type: lendForm.type,
      registrationNumber: lendForm.registrationNumber.toUpperCase(),
      makeModel: lendForm.makeModel,
      modelYear: lendForm.modelYear,
      capacityTons: lendForm.capacityTons,
      dimensions: lendForm.dimensions,
      fuelType: lendForm.fuelType,
      ownership: lendForm.ownership,
      location: lendForm.location,
      serviceArea: lendForm.serviceArea,
      availableFrom: lendForm.availableFrom,
      availableUntil: lendForm.availableUntil,
      priceAmount: lendForm.priceAmount,
      priceUnit: lendForm.priceUnit,
      driverAvailable: lendForm.driverAvailable,
      permittedUsage: lendForm.permittedUsage,
      contactName: lendForm.contactName || user?.name || "",
      contactPhone: lendForm.contactPhone || settingsForm.companyPhone || "",
      contactEmail: lendForm.contactEmail || user?.email || "",
      notes: lendForm.notes,
      documents: {
        rcAttached: lendForm.rcAttached,
        fitnessAttached: lendForm.fitnessAttached,
        insuranceAttached: lendForm.insuranceAttached,
        permitAttached: lendForm.permitAttached,
      },
      status: "Active Listing",
      createdAt: new Date().toISOString().split("T")[0],
    };

    const updatedLent = [newVehicle, ...lentVehicles];
    setLentVehicles(updatedLent);

    // Save strictly under the authenticated user's account
    try {
      localStorage.setItem(`gleska_logistics_${currentUserId}_lent`, JSON.stringify(updatedLent));
    } catch (e) {
      console.error("Failed to save to local storage", e);
    }

    showToast(`Vehicle ${newVehicle.registrationNumber} (${newVehicle.makeModel}) listed successfully in fleet inventory.`, "success");

    // Reset form registration field
    setLendForm((prev) => ({
      ...prev,
      registrationNumber: "",
      notes: "",
    }));

    // Switch to Vehicle Details -> Vehicles Lent
    setActiveTab("vehicle-details");
    setVehicleDetailsSubTab("lent");
  };

  // Open Rental Request Modal for a matched vehicle
  const handleOpenRentalModal = (vehicle: VehicleListing) => {
    setSelectedVehicleForRental(vehicle);
    setRentalRequestForm({
      sourceLocation: getForm.sourceLocation || vehicle.location,
      destinationLocation: getForm.destinationLocation || "Jaipur",
      pickupDate: getForm.pickupDate,
      rentalDuration: getForm.rentalDuration,
      offeredPrice: vehicle.priceAmount,
      driverRequired: getForm.driverRequired,
      cargoType: "Industrial Goods / Raw Material",
      instructions: "Requires commercial e-Way bill support and verified driver.",
    });
  };

  // Submit Rental Request for a vehicle
  const handleSubmitRentalRequest = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVehicleForRental) return;

    if (!rentalRequestForm.sourceLocation.trim() || !rentalRequestForm.destinationLocation.trim()) {
      showToast("Source and Destination locations are required to submit dispatch request.", "error");
      return;
    }

    const newRequest: VehicleRentalRequest = {
      id: `req-${Date.now()}`,
      userId: currentUserId,
      companyName: settingsForm.businessName || user?.name || "Industrial Shipper",
      vehicleId: selectedVehicleForRental.id,
      vehicleTitle: `${selectedVehicleForRental.makeModel} (${selectedVehicleForRental.type})`,
      vehicleReg: selectedVehicleForRental.registrationNumber,
      category: selectedVehicleForRental.category,
      sourceLocation: rentalRequestForm.sourceLocation,
      destinationLocation: rentalRequestForm.destinationLocation,
      pickupDate: rentalRequestForm.pickupDate,
      rentalDuration: rentalRequestForm.rentalDuration,
      offeredPrice: rentalRequestForm.offeredPrice,
      priceUnit: selectedVehicleForRental.priceUnit,
      driverRequired: rentalRequestForm.driverRequired,
      cargoType: rentalRequestForm.cargoType,
      instructions: rentalRequestForm.instructions,
      status: "Request Submitted",
      createdAt: new Date().toISOString().split("T")[0],
    };

    const updatedObtained = [newRequest, ...obtainedVehicles];
    setObtainedVehicles(updatedObtained);

    try {
      localStorage.setItem(`gleska_logistics_${currentUserId}_obtained`, JSON.stringify(updatedObtained));
    } catch (e) {
      console.error("Failed to save rental request", e);
    }

    showToast(`Rental request for ${selectedVehicleForRental.registrationNumber} submitted successfully.`, "success");
    setSelectedVehicleForRental(null);

    // Switch to Vehicle Details -> Vehicles Obtained
    setActiveTab("vehicle-details");
    setVehicleDetailsSubTab("obtained");
  };

  return (
    <AgentLayout
      config={logisticsConfig}
      activeTab={activeTab}
      setActiveTab={handleTabChange}
    >
      {/* Toast Notification Container */}
      {toast && (
        <div
          className={`fixed top-5 right-5 z-50 flex items-center gap-2.5 rounded-xl border px-4 py-3 text-xs font-semibold shadow-xl backdrop-blur-md transition-all animate-in fade-in slide-in-from-top-3 ${
            toast.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/90 dark:text-emerald-200"
              : toast.type === "error"
              ? "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/90 dark:text-rose-200"
              : "border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-800 dark:bg-indigo-950/90 dark:text-indigo-200"
          }`}
        >
          {toast.type === "success" && <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400 shrink-0" />}
          {toast.type === "error" && <AlertCircle size={16} className="text-rose-600 dark:text-rose-400 shrink-0" />}
          {toast.type === "info" && <Sparkles size={16} className="text-indigo-600 dark:text-indigo-400 shrink-0" />}
          <span>{toast.message}</span>
          <button
            onClick={() => setToast(null)}
            className="ml-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Hidden File Inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,.xlsx,.csv,image/png,image/jpeg,image/webp,image/svg+xml,image/*"
        onChange={handleFileUpload}
        className="hidden"
      />
      <input
        ref={photoInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/jpg"
        onChange={handlePhotoSelect}
        className="hidden"
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleCameraCaptureFallback}
        className="hidden"
      />

      {/* Live Camera Viewfinder Modal */}
      {showCameraModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm animate-in fade-in">
          <div className="relative w-full max-w-lg rounded-3xl border border-slate-700 bg-slate-900 p-6 text-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-2">
                <Camera size={20} className="text-emerald-400" />
                <h3 className="text-sm font-bold uppercase tracking-wider">Vehicle & Document Camera Scanner</h3>
              </div>
              <button
                type="button"
                onClick={closeCameraModal}
                className="rounded-full p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="relative mt-4 overflow-hidden rounded-2xl bg-black aspect-video flex items-center justify-center border border-slate-800">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="h-full w-full object-cover"
              />
              <div className="pointer-events-none absolute inset-6 rounded-xl border-2 border-dashed border-emerald-400/60" />
              <div className="pointer-events-none absolute bottom-3 left-0 right-0 text-center text-[11px] font-semibold text-white/80 bg-slate-900/60 py-1">
                Align vehicle photo, RC plate, or fitness certificate inside frame
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={closeCameraModal}
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={capturePhotoFromStream}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2 text-xs font-bold text-white shadow-lg shadow-emerald-600/30 hover:bg-emerald-500 active:scale-95 transition cursor-pointer"
              >
                <Camera size={16} />
                <span>Capture Vehicle Photo</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rental Request Modal ("Get Vehicle") */}
      {selectedVehicleForRental && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs animate-in fade-in">
          <div className="relative w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-3xl border border-slate-200 bg-white p-6 sm:p-8 shadow-2xl dark:border-slate-800 dark:bg-slate-900 text-slate-900 dark:text-white">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Truck className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                <h3 className="text-base font-bold">Request Vehicle Dispatch</h3>
              </div>
              <button
                onClick={() => setSelectedVehicleForRental(null)}
                className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-white cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-4 rounded-2xl bg-slate-50 p-4 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold">{selectedVehicleForRental.makeModel}</h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {selectedVehicleForRental.type} • Reg: <span className="font-mono font-semibold">{selectedVehicleForRental.registrationNumber}</span>
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold font-mono text-emerald-600 dark:text-emerald-400">
                    ₹ {selectedVehicleForRental.priceAmount.toLocaleString()}
                  </p>
                  <p className="text-[10px] text-slate-400">{selectedVehicleForRental.priceUnit}</p>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                <span className="rounded-md bg-white dark:bg-slate-900 px-2 py-0.5 border border-slate-200 dark:border-slate-700">
                  Capacity: {selectedVehicleForRental.capacityTons} MT
                </span>
                <span className="rounded-md bg-white dark:bg-slate-900 px-2 py-0.5 border border-slate-200 dark:border-slate-700">
                  Base Hub: {selectedVehicleForRental.location}
                </span>
                <span className="rounded-md bg-white dark:bg-slate-900 px-2 py-0.5 border border-slate-200 dark:border-slate-700">
                  Permit: {selectedVehicleForRental.serviceArea}
                </span>
              </div>
            </div>

            <form onSubmit={handleSubmitRentalRequest} className="mt-5 space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-600 dark:text-slate-400 mb-1">
                    Pickup Location *
                  </label>
                  <input
                    type="text"
                    required
                    value={rentalRequestForm.sourceLocation}
                    onChange={(e) => setRentalRequestForm({ ...rentalRequestForm, sourceLocation: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-semibold text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-600 dark:text-slate-400 mb-1">
                    Destination Location *
                  </label>
                  <input
                    type="text"
                    required
                    value={rentalRequestForm.destinationLocation}
                    onChange={(e) => setRentalRequestForm({ ...rentalRequestForm, destinationLocation: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-semibold text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-600 dark:text-slate-400 mb-1">
                    Required Pickup Date
                  </label>
                  <input
                    type="date"
                    value={rentalRequestForm.pickupDate}
                    onChange={(e) => setRentalRequestForm({ ...rentalRequestForm, pickupDate: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-semibold text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-600 dark:text-slate-400 mb-1">
                    Rental Duration / Scope
                  </label>
                  <input
                    type="text"
                    value={rentalRequestForm.rentalDuration}
                    onChange={(e) => setRentalRequestForm({ ...rentalRequestForm, rentalDuration: e.target.value })}
                    placeholder="e.g. 1 Day, 3 Days, Round-trip"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-semibold text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-600 dark:text-slate-400 mb-1">
                  Cargo Description & Weight
                </label>
                <input
                  type="text"
                  value={rentalRequestForm.cargoType}
                  onChange={(e) => setRentalRequestForm({ ...rentalRequestForm, cargoType: e.target.value })}
                  placeholder="e.g. 12 Tons Structural Steel Rods"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-semibold text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-600 dark:text-slate-400 mb-1">
                  Special Instructions
                </label>
                <textarea
                  rows={2}
                  value={rentalRequestForm.instructions}
                  onChange={(e) => setRentalRequestForm({ ...rentalRequestForm, instructions: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setSelectedVehicleForRental(null)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white shadow-md shadow-emerald-600/30 hover:bg-emerald-700 transition cursor-pointer"
                >
                  <Send size={14} />
                  <span>Submit Rental Request</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SECTION 2: UPWARD FREED SPACE SELECTOR + COMPACT FUNCTIONAL SEARCH BAR    */}
      {/* ========================================================================= */}
      <div className="relative z-30 flex flex-col items-center justify-center space-y-3 sm:space-y-5 pt-0 sm:pt-1">
        {/* Compact Segmented Control (Lend Your Vehicle / Get Vehicle) */}
        <div className="inline-flex items-center rounded-full border border-slate-200/90 bg-white/95 p-1.5 shadow-sm backdrop-blur-md dark:border-slate-800/90 dark:bg-slate-900/95">
          <button
            type="button"
            onClick={() => handleSelectorChange("lend")}
            className={`flex items-center gap-2 rounded-full px-5 py-2 text-xs sm:text-sm font-semibold transition-all duration-200 cursor-pointer ${
              selectedOption === "lend"
                ? "bg-emerald-600 text-white font-bold shadow-xs dark:bg-emerald-600"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-100/70 dark:text-slate-300 dark:hover:text-white dark:hover:bg-slate-800/70"
            }`}
          >
            <Truck size={16} />
            <span>Lend Your Vehicle</span>
          </button>
          <button
            type="button"
            onClick={() => handleSelectorChange("get")}
            className={`flex items-center gap-2 rounded-full px-5 py-2 text-xs sm:text-sm font-semibold transition-all duration-200 cursor-pointer ${
              selectedOption === "get"
                ? "bg-emerald-600 text-white font-bold shadow-xs dark:bg-emerald-600"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-100/70 dark:text-slate-300 dark:hover:text-white dark:hover:bg-slate-800/70"
            }`}
          >
            <Key size={16} />
            <span>Get Vehicle</span>
          </button>
        </div>

        {/* Compact Functional Search Bar Directly Below Selector */}
        <div className="relative z-40 mx-auto w-full max-w-2xl">
          <div className="relative flex items-center rounded-full border border-slate-200/90 bg-white/95 p-1.5 shadow-sm backdrop-blur-md transition-all focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/20 dark:border-slate-800 dark:bg-slate-900/95">
            {/* Left: Plus (+) Button & Dropdown Menu */}
            <div className="relative" ref={plusMenuRef}>
              <button
                ref={plusButtonRef}
                type="button"
                onClick={handleTogglePlusMenu}
                className={`flex h-9 w-9 items-center justify-center rounded-full transition-all cursor-pointer ${
                  isPlusMenuOpen
                    ? "bg-emerald-600 text-white rotate-45 shadow-md shadow-emerald-600/30"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white"
                }`}
                title="Add Document, Photo, or File"
                aria-label="Add Document or Photo"
              >
                <Plus size={18} />
              </button>

              {/* Plus Menu Popup */}
              {isPlusMenuOpen && (
                <div
                  className={`absolute left-0 z-50 w-60 max-w-[calc(100vw-32px)] rounded-2xl border border-slate-200/90 bg-white/95 p-1.5 shadow-2xl backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/95 animate-in fade-in zoom-in-95 duration-150 ${
                    menuPlacement === "top"
                      ? "bottom-full mb-2.5 origin-bottom-left"
                      : "top-full mt-2.5 origin-top-left"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setIsPlusMenuOpen(false);
                      fileInputRef.current?.click();
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800 transition text-left cursor-pointer"
                  >
                    <Upload size={16} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <div>
                      <p className="font-bold">Upload File</p>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400">RC, Insurance, Fitness Docs</p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={triggerTakePhoto}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800 transition text-left cursor-pointer"
                  >
                    <Camera size={16} className="text-purple-600 dark:text-purple-400 shrink-0" />
                    <div>
                      <p className="font-bold">Take Photo</p>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400">Capture vehicle or paper permit</p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsPlusMenuOpen(false);
                      photoInputRef.current?.click();
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800 transition text-left cursor-pointer"
                  >
                    <ImageIcon size={16} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
                    <div>
                      <p className="font-bold">Choose Photo</p>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400">Select image from device</p>
                    </div>
                  </button>
                </div>
              )}
            </div>

            {/* Center: Search / AI Natural Language Input */}
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (selectedOption === "lend") handleExtractLendQuery();
                  else handleExtractGetQuery();
                }
              }}
              placeholder={
                selectedOption === "lend"
                  ? "e.g. I want to list my 14-ton truck in Delhi for ₹8,000 per day..."
                  : "e.g. I need a 10-ton truck from Delhi to Jaipur on 20 October, budget ₹15,000..."
              }
              className="flex-1 bg-transparent px-3 text-xs sm:text-sm font-medium text-slate-900 placeholder:text-slate-400 outline-none dark:text-white"
            />

            {/* Right: Listening Indicator + Mic + AI Search Action Buttons */}
            <div className="flex items-center gap-1 sm:gap-1.5 pr-1">
              {isListening && (
                <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-2.5 py-1 text-[11px] font-semibold text-red-600 dark:text-red-400 animate-pulse">
                  <span className="h-2 w-2 rounded-full bg-red-600 animate-ping" />
                  Listening...
                </span>
              )}

              {/* Microphone Button */}
              <button
                type="button"
                onClick={toggleListening}
                className={`flex h-9 w-9 items-center justify-center rounded-full transition cursor-pointer ${
                  isListening
                    ? "bg-red-500 text-white shadow-md shadow-red-500/30 animate-pulse"
                    : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                }`}
                title={isListening ? "Click to stop listening" : "Speak to search (Voice Input)"}
                aria-label={isListening ? "Stop voice listening" : "Start voice listening"}
              >
                {isListening ? <MicOff size={17} /> : <Mic size={17} />}
              </button>

              {/* AI Search / Submit Button */}
              <button
                type="button"
                onClick={() => {
                  if (selectedOption === "lend") handleExtractLendQuery();
                  else handleExtractGetQuery();
                }}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 active:scale-95 transition cursor-pointer"
                title={selectedOption === "lend" ? "AI Extract Vehicle Listing" : "AI Search Fleet"}
                aria-label="Execute search"
              >
                <Search size={16} />
              </button>
            </div>
          </div>

          {/* Attached Document Indicator Badge (if any) */}
          {attachedFile && (
            <div className="mt-2.5 flex items-center justify-between rounded-xl border border-emerald-200/90 bg-emerald-50/80 px-3.5 py-2 text-xs font-semibold text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/60 dark:text-emerald-200 animate-in fade-in">
              <div className="flex items-center gap-2 truncate">
                <FileCheck size={16} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span className="truncate">
                  Attached: <strong>{attachedFile.name}</strong> ({attachedFile.size})
                </span>
                <span className="rounded-md bg-emerald-200/60 dark:bg-emerald-900/80 px-1.5 py-0.5 text-[10px] uppercase font-bold text-emerald-700 dark:text-emerald-300">
                  {attachedFile.source}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setAttachedFile(null)}
                className="ml-2 text-emerald-500 hover:text-emerald-800 dark:hover:text-white cursor-pointer"
                title="Remove attached file"
              >
                <X size={15} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* SECTION 3: TAB VIEWS (DASHBOARD, LEND, GET, DETAILS, HELP, SETTINGS)      */}
      {/* ========================================================================= */}

      {/* VIEW 1: DASHBOARD OVERVIEW */}
      {activeTab === "dashboard" && (
        <div className="space-y-6 sm:space-y-8 mt-3 sm:mt-6 md:mt-8 lg:mt-10">
          {/* Quick Metrics Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-2xl border border-slate-200/80 bg-white/95 p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/95">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Your Listed Fleet
                </span>
                <span className="rounded-lg bg-emerald-50 p-2 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
                  <Truck size={18} />
                </span>
              </div>
              <p className="mt-3 text-2xl font-bold text-slate-900 dark:text-white font-mono">
                {lentVehicles.length} Vehicles
              </p>
              <p className="mt-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">
                Available for commercial dispatch
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/80 bg-white/95 p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/95">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Vehicles Obtained
                </span>
                <span className="rounded-lg bg-indigo-50 p-2 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
                  <Key size={18} />
                </span>
              </div>
              <p className="mt-3 text-2xl font-bold text-slate-900 dark:text-white font-mono">
                {obtainedVehicles.length} Requests
              </p>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 font-semibold">
                Active & completed bookings
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/80 bg-white/95 p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/95">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Fleet Network Hubs
                </span>
                <span className="rounded-lg bg-purple-50 p-2 text-purple-600 dark:bg-purple-950/60 dark:text-purple-400">
                  <MapPin size={18} />
                </span>
              </div>
              <p className="mt-3 text-2xl font-bold text-slate-900 dark:text-white font-mono">14 Cities</p>
              <p className="mt-1 text-[11px] text-purple-600 dark:text-purple-400 font-semibold">
                All India National Permit network
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/80 bg-white/95 p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/95">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Compliance Status
                </span>
                <span className="rounded-lg bg-cyan-50 p-2 text-cyan-600 dark:bg-cyan-950/60 dark:text-cyan-400">
                  <ShieldCheck size={18} />
                </span>
              </div>
              <p className="mt-3 text-2xl font-bold text-slate-900 dark:text-white font-mono">100% Verified</p>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 font-semibold">
                RC & Commercial fitness verified
              </p>
            </div>
          </div>

          {/* Quick Access Dual Action Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div
              onClick={() => handleSelectorChange("lend")}
              className="group rounded-3xl border border-slate-200/90 bg-white/95 p-6 shadow-sm hover:shadow-md transition-all border-t-4 border-t-emerald-500 cursor-pointer dark:border-slate-800 dark:bg-slate-900/95"
            >
              <div className="flex items-center justify-between">
                <span className="rounded-xl bg-emerald-50 p-3 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400 group-hover:scale-110 transition-transform">
                  <Truck size={24} />
                </span>
                <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                  List Fleet <ArrowRight size={14} />
                </span>
              </div>
              <h3 className="mt-4 text-lg font-bold text-slate-900 dark:text-white">Lend Your Vehicle</h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Register trucks, trailers, and commercial fleets to receive verified dispatch freight requests.
              </p>
            </div>

            <div
              onClick={() => handleSelectorChange("get")}
              className="group rounded-3xl border border-slate-200/90 bg-white/95 p-6 shadow-sm hover:shadow-md transition-all border-t-4 border-t-indigo-500 cursor-pointer dark:border-slate-800 dark:bg-slate-900/95"
            >
              <div className="flex items-center justify-between">
                <span className="rounded-xl bg-indigo-50 p-3 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400 group-hover:scale-110 transition-transform">
                  <Key size={24} />
                </span>
                <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 flex items-center gap-1">
                  Find Transport <ArrowRight size={14} />
                </span>
              </div>
              <h3 className="mt-4 text-lg font-bold text-slate-900 dark:text-white">Get Vehicle</h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Search verified commercial trucks, multi-axle trailers, and reefers by route, capacity, and budget.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 2: LEND YOUR VEHICLE (MANUAL LISTING FORM) */}
      {activeTab === "lend" && (
        <div className="space-y-6 rounded-3xl border border-slate-200/80 bg-white/95 p-6 sm:p-8 shadow-xl backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/95 mt-3 sm:mt-6 md:mt-8 lg:mt-10">
          <div className="border-b border-slate-100 pb-5 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
                <Truck size={14} />
                <span>COMMERCIAL VEHICLE LISTING</span>
              </div>
              <h2 className="mt-2 text-xl font-bold text-slate-900 dark:text-white">
                List Commercial Vehicle for Dispatch
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Enter vehicle specifications and compliance verification. Fields marked with * are required.
              </p>
            </div>
          </div>

          <form onSubmit={handleSaveVehicleListing} className="space-y-6 text-xs">
            {/* 1. Basic Identification */}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-3">
                1. Vehicle Identification & Specifications
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Vehicle Category *
                  </label>
                  <select
                    value={lendForm.category}
                    onChange={(e) => setLendForm({ ...lendForm, category: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    <option value="Heavy Commercial Vehicle">Heavy Commercial Vehicle (HCV)</option>
                    <option value="Medium Commercial Vehicle">Medium Commercial Vehicle (MCV)</option>
                    <option value="Light Commercial Vehicle">Light Commercial Vehicle (LCV)</option>
                    <option value="Trailer / Flatbed">Trailer / Flatbed Container</option>
                    <option value="Refrigerated Transport">Refrigerated Reefer Truck</option>
                    <option value="Tipper / Dumper">Tipper / Dumper</option>
                    <option value="Tanker">Liquid Tanker</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Vehicle Type / Body *
                  </label>
                  <input
                    type="text"
                    required
                    value={lendForm.type}
                    onChange={(e) => setLendForm({ ...lendForm, type: e.target.value })}
                    placeholder="e.g. 14-Ton Multi-Axle Rigid Truck"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Registration Number (RC) *
                  </label>
                  <input
                    type="text"
                    required
                    value={lendForm.registrationNumber}
                    onChange={(e) => setLendForm({ ...lendForm, registrationNumber: e.target.value.toUpperCase() })}
                    placeholder="e.g. DL 01 AB 1234"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 font-mono font-bold uppercase text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Make, Model & Year *
                  </label>
                  <input
                    type="text"
                    required
                    value={lendForm.makeModel}
                    onChange={(e) => setLendForm({ ...lendForm, makeModel: e.target.value })}
                    placeholder="e.g. Tata Prima 2830.K (2022)"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  />
                </div>
              </div>
            </div>

            {/* 2. Payload, Dimensions & Fuel */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Load Capacity (Tons / MT) *
                </label>
                <input
                  type="number"
                  min="0.5"
                  step="0.5"
                  required
                  value={lendForm.capacityTons}
                  onChange={(e) => setLendForm({ ...lendForm, capacityTons: parseFloat(e.target.value) || 0 })}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 font-mono font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Dimensions (L x W x H)
                </label>
                <input
                  type="text"
                  value={lendForm.dimensions}
                  onChange={(e) => setLendForm({ ...lendForm, dimensions: e.target.value })}
                  placeholder="e.g. 24ft x 8ft x 8.5ft"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Fuel Type
                </label>
                <select
                  value={lendForm.fuelType}
                  onChange={(e) => setLendForm({ ...lendForm, fuelType: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                >
                  <option value="Diesel">Diesel</option>
                  <option value="CNG">CNG</option>
                  <option value="Electric">Electric (EV)</option>
                  <option value="LNG">LNG</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Ownership Details
                </label>
                <select
                  value={lendForm.ownership}
                  onChange={(e) => setLendForm({ ...lendForm, ownership: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                >
                  <option value="Owned by Company">Owned by Company</option>
                  <option value="Authorized Logistics Operator">Authorized Logistics Operator</option>
                  <option value="Commercial Lease">Commercial Lease</option>
                </select>
              </div>
            </div>

            {/* 3. Operational Hub, Permit & Rates */}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-3">
                2. Operational Hub, Pricing & Driver Policy
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Current Base Hub / City *
                  </label>
                  <input
                    type="text"
                    required
                    value={lendForm.location}
                    onChange={(e) => setLendForm({ ...lendForm, location: e.target.value })}
                    placeholder="e.g. Delhi-NCR, Mumbai, Jaipur"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Service Area / Permit
                  </label>
                  <select
                    value={lendForm.serviceArea}
                    onChange={(e) => setLendForm({ ...lendForm, serviceArea: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    <option value="All India Permit (National)">All India Permit (National)</option>
                    <option value="North India Region">North India Region</option>
                    <option value="West India Region">West India Region</option>
                    <option value="State Transport Permit">State Transport Permit Only</option>
                    <option value="Local Intra-City">Local Intra-City</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Rental Price Rate (₹) *
                  </label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={lendForm.priceAmount}
                    onChange={(e) => setLendForm({ ...lendForm, priceAmount: parseInt(e.target.value, 10) || 0 })}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 font-mono font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Pricing Unit *
                  </label>
                  <select
                    value={lendForm.priceUnit}
                    onChange={(e) => setLendForm({ ...lendForm, priceUnit: e.target.value as any })}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    <option value="per day">₹ / Day</option>
                    <option value="per trip">₹ / Trip</option>
                    <option value="per km">₹ / Km</option>
                    <option value="per ton">₹ / Ton</option>
                  </select>
                </div>
              </div>
            </div>

            {/* 4. Driver & Permitted Cargo */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Driver Availability
                </label>
                <select
                  value={lendForm.driverAvailable}
                  onChange={(e) => setLendForm({ ...lendForm, driverAvailable: e.target.value as any })}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                >
                  <option value="With Driver">Vehicle Provided With Verified Commercial Driver</option>
                  <option value="Without Driver">Bare Vehicle Rental (Without Driver)</option>
                  <option value="On Request">Driver Available Upon Request</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Permitted Cargo & Usage Conditions
                </label>
                <input
                  type="text"
                  value={lendForm.permittedUsage}
                  onChange={(e) => setLendForm({ ...lendForm, permittedUsage: e.target.value })}
                  placeholder="e.g. Dry Industrial Goods, Metals, Hardware (Non-Hazardous)"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                />
              </div>
            </div>

            {/* 5. Authoritative Indian Compliance Checklist */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-800/40">
              <h4 className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                <ShieldCheck size={16} className="text-emerald-600 dark:text-emerald-400" />
                <span>Statutory Compliance Checklist (Motor Vehicles Act)</span>
              </h4>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                Confirm availability of valid regulatory documentation for commercial dispatch.
              </p>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-900 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={lendForm.rcAttached}
                    onChange={(e) => setLendForm({ ...lendForm, rcAttached: e.target.checked })}
                    className="h-4 w-4 accent-emerald-600 rounded"
                  />
                  <span>
                    <strong className="block text-slate-800 dark:text-slate-200">Registration (RC) *</strong>
                    <span className="text-[10px] text-slate-400">Mandatory Form 23</span>
                  </span>
                </label>

                <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-900 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={lendForm.fitnessAttached}
                    onChange={(e) => setLendForm({ ...lendForm, fitnessAttached: e.target.checked })}
                    className="h-4 w-4 accent-emerald-600 rounded"
                  />
                  <span>
                    <strong className="block text-slate-800 dark:text-slate-200">Fitness Certificate *</strong>
                    <span className="text-[10px] text-slate-400">Form 38 Valid</span>
                  </span>
                </label>

                <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-900 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={lendForm.insuranceAttached}
                    onChange={(e) => setLendForm({ ...lendForm, insuranceAttached: e.target.checked })}
                    className="h-4 w-4 accent-emerald-600 rounded"
                  />
                  <span>
                    <strong className="block text-slate-800 dark:text-slate-200">Commercial Insurance</strong>
                    <span className="text-[10px] text-slate-400">Third-Party / Comp</span>
                  </span>
                </label>

                <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-900 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={lendForm.permitAttached}
                    onChange={(e) => setLendForm({ ...lendForm, permitAttached: e.target.checked })}
                    className="h-4 w-4 accent-emerald-600 rounded"
                  />
                  <span>
                    <strong className="block text-slate-800 dark:text-slate-200">National Permit</strong>
                    <span className="text-[10px] text-slate-400">Form 48 (If Inter-State)</span>
                  </span>
                </label>
              </div>
            </div>

            {/* 6. Contact Details & Submit */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Contact Phone Number
                </label>
                <input
                  type="text"
                  value={lendForm.contactPhone}
                  onChange={(e) => setLendForm({ ...lendForm, contactPhone: e.target.value })}
                  placeholder="+91 98XXX XXXXX"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Additional Fleet Instructions
                </label>
                <input
                  type="text"
                  value={lendForm.notes}
                  onChange={(e) => setLendForm({ ...lendForm, notes: e.target.value })}
                  placeholder="e.g. Equipped with fastag, fuel terms, advance required"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => handleTabChange("dashboard")}
                className="rounded-xl border border-slate-200 px-5 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-6 py-2.5 text-xs font-bold text-white shadow-md shadow-emerald-600/30 hover:bg-emerald-700 active:scale-95 transition cursor-pointer"
              >
                <Check size={15} />
                <span>Publish Vehicle Listing</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* VIEW 3: GET VEHICLE (MANUAL SEARCH & RENTAL DISPATCH) */}
      {activeTab === "get" && (
        <div className="space-y-6 rounded-3xl border border-slate-200/80 bg-white/95 p-6 sm:p-8 shadow-xl backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/95 mt-3 sm:mt-6 md:mt-8 lg:mt-10">
          <div className="border-b border-slate-100 pb-5 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
                <Key size={14} />
                <span>COMMERCIAL FLEET DISCOVERY</span>
              </div>
              <h2 className="mt-2 text-xl font-bold text-slate-900 dark:text-white">
                Find & Request Verified Transport
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Specify route, required tonnage, and budget to search available fleets.
              </p>
            </div>
          </div>

          {/* Search Criteria Form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              executeFleetSearch();
            }}
            className="rounded-2xl border border-slate-200/80 bg-slate-50/60 p-4 sm:p-5 dark:border-slate-700 dark:bg-slate-800/40 text-xs space-y-4"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Pickup / Source Hub
                </label>
                <input
                  type="text"
                  value={getForm.sourceLocation}
                  onChange={(e) => setGetForm({ ...getForm, sourceLocation: e.target.value })}
                  placeholder="e.g. Delhi, Mumbai, Jaipur"
                  className="w-full rounded-xl border border-slate-200 bg-white p-2.5 font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Destination Location
                </label>
                <input
                  type="text"
                  value={getForm.destinationLocation}
                  onChange={(e) => setGetForm({ ...getForm, destinationLocation: e.target.value })}
                  placeholder="e.g. Jaipur, Ahmedabad, Pune"
                  className="w-full rounded-xl border border-slate-200 bg-white p-2.5 font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Required Minimum Capacity (Tons)
                </label>
                <input
                  type="number"
                  min="0.5"
                  step="0.5"
                  value={getForm.minCapacityTons}
                  onChange={(e) => setGetForm({ ...getForm, minCapacityTons: parseFloat(e.target.value) || 0 })}
                  className="w-full rounded-xl border border-slate-200 bg-white p-2.5 font-mono font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Max Budget Cap (₹)
                </label>
                <input
                  type="number"
                  min="500"
                  value={getForm.maxBudget}
                  onChange={(e) => setGetForm({ ...getForm, maxBudget: parseInt(e.target.value, 10) || 0 })}
                  className="w-full rounded-xl border border-slate-200 bg-white p-2.5 font-mono font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <label className="flex items-center gap-2 cursor-pointer text-slate-700 dark:text-slate-300 font-medium">
                <input
                  type="checkbox"
                  checked={getForm.driverRequired}
                  onChange={(e) => setGetForm({ ...getForm, driverRequired: e.target.checked })}
                  className="h-4 w-4 accent-emerald-600 rounded"
                />
                <span>Must include verified commercial driver</span>
              </label>

              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 transition cursor-pointer"
              >
                <Search size={14} />
                <span>Search Matching Fleet</span>
              </button>
            </div>
          </form>

          {/* Search Results Display */}
          {hasExecutedSearch && (
            <div className="space-y-4 pt-2">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Available Fleet Results ({searchResults?.length || 0})
              </h3>

              {!searchResults || searchResults.length === 0 ? (
                <div className="py-12 text-center rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 p-6">
                  <Truck className="mx-auto h-8 w-8 text-slate-400" />
                  <p className="mt-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
                    No matching vehicles found for these criteria.
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Try adjusting your tonnage requirement, widening location radius, or increasing budget.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {searchResults.map((vehicle) => (
                    <div
                      key={vehicle.id}
                      className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs hover:border-emerald-300 hover:shadow-md transition dark:border-slate-800 dark:bg-slate-900/90 flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex items-center justify-between">
                          <span className="rounded-lg bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                            {vehicle.category}
                          </span>
                          <span className="font-mono font-bold text-base text-slate-900 dark:text-white">
                            ₹ {vehicle.priceAmount.toLocaleString()} <span className="text-xs text-slate-400 font-normal">/{vehicle.priceUnit.replace("per ", "")}</span>
                          </span>
                        </div>

                        <h4 className="mt-3 text-base font-bold text-slate-900 dark:text-white">
                          {vehicle.makeModel}
                        </h4>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {vehicle.type} • Reg: <span className="font-mono font-semibold">{vehicle.registrationNumber}</span>
                        </p>

                        <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                          <span className="rounded-md bg-slate-50 dark:bg-slate-800 px-2 py-0.5 border border-slate-100 dark:border-slate-700">
                            Payload: <strong>{vehicle.capacityTons} MT</strong>
                          </span>
                          <span className="rounded-md bg-slate-50 dark:bg-slate-800 px-2 py-0.5 border border-slate-100 dark:border-slate-700">
                            Hub: <strong>{vehicle.location}</strong>
                          </span>
                          <span className="rounded-md bg-slate-50 dark:bg-slate-800 px-2 py-0.5 border border-slate-100 dark:border-slate-700">
                            Driver: <strong>{vehicle.driverAvailable}</strong>
                          </span>
                        </div>

                        <p className="mt-2.5 text-xs text-slate-500 dark:text-slate-400 line-clamp-2">
                          {vehicle.permittedUsage}
                        </p>
                      </div>

                      <div className="mt-5 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                        <span className="text-[11px] text-slate-400">
                          Fleet: {vehicle.companyName}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleOpenRentalModal(vehicle)}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 transition cursor-pointer"
                        >
                          <span>Request Rental</span>
                          <ArrowRight size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* VIEW 4: VEHICLE DETAILS (VEHICLES LENT & VEHICLES OBTAINED) */}
      {activeTab === "vehicle-details" && (
        <div className="space-y-6 rounded-3xl border border-slate-200/80 bg-white/95 p-6 sm:p-8 shadow-xl backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/95 mt-3 sm:mt-6 md:mt-8 lg:mt-10">
          <div className="border-b border-slate-100 pb-5 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-cyan-50 px-3 py-1 text-xs font-bold text-cyan-600 dark:bg-cyan-950/60 dark:text-cyan-400">
                <ClipboardList size={14} />
                <span>FLEET RECORDS & LOGS</span>
              </div>
              <h2 className="mt-2 text-xl font-bold text-slate-900 dark:text-white">Vehicle Details</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Track your active vehicle listings and your submitted dispatch bookings.
              </p>
            </div>

            {/* Sub-tabs: Vehicles Lent vs Vehicles Obtained */}
            <div className="inline-flex items-center rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
              <button
                type="button"
                onClick={() => setVehicleDetailsSubTab("lent")}
                className={`rounded-lg px-4 py-2 text-xs font-bold transition cursor-pointer ${
                  vehicleDetailsSubTab === "lent"
                    ? "bg-white text-emerald-700 shadow-xs dark:bg-slate-900 dark:text-emerald-400"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                }`}
              >
                Vehicles Lent ({lentVehicles.length})
              </button>
              <button
                type="button"
                onClick={() => setVehicleDetailsSubTab("obtained")}
                className={`rounded-lg px-4 py-2 text-xs font-bold transition cursor-pointer ${
                  vehicleDetailsSubTab === "obtained"
                    ? "bg-white text-indigo-700 shadow-xs dark:bg-slate-900 dark:text-indigo-400"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                }`}
              >
                Vehicles Obtained ({obtainedVehicles.length})
              </button>
            </div>
          </div>

          {/* Sub-tab 1: Vehicles Lent */}
          {vehicleDetailsSubTab === "lent" && (
            <div className="space-y-4">
              {lentVehicles.length === 0 ? (
                <div className="py-12 text-center rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 p-6">
                  <Truck className="mx-auto h-8 w-8 text-slate-400" />
                  <h4 className="mt-2 text-sm font-bold text-slate-900 dark:text-white">
                    No Vehicles Listed Yet
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">
                    You have not registered any commercial vehicles for lending under this account.
                  </p>
                  <button
                    type="button"
                    onClick={() => handleSelectorChange("lend")}
                    className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 transition cursor-pointer"
                  >
                    <Plus size={14} />
                    <span>List a Vehicle Now</span>
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {lentVehicles.map((v) => (
                    <div
                      key={v.id}
                      className="py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-slate-50/50 dark:hover:bg-slate-800/40 rounded-xl px-2 transition"
                    >
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 rounded-lg bg-emerald-50 p-2 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
                          <Truck size={18} />
                        </span>
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="text-sm font-bold text-slate-900 dark:text-white">{v.makeModel}</h4>
                            <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                              {v.status}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            {v.type} • Reg: <span className="font-mono font-bold text-slate-700 dark:text-slate-300">{v.registrationNumber}</span> • Base: {v.location}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                            <span>Capacity: <strong>{v.capacityTons} MT</strong></span>
                            <span>•</span>
                            <span>Permit: {v.serviceArea}</span>
                            <span>•</span>
                            <span>Driver: {v.driverAvailable}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between md:justify-end gap-4">
                        <div className="text-right">
                          <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                            ₹ {v.priceAmount.toLocaleString()}
                          </span>
                          <span className="block text-[10px] text-slate-400">{v.priceUnit}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            showToast(`Documents verified: RC (${v.documents.rcAttached ? "Yes" : "No"}), Fitness (${v.documents.fitnessAttached ? "Yes" : "No"})`, "info");
                          }}
                          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 transition cursor-pointer"
                        >
                          View Docs
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Sub-tab 2: Vehicles Obtained */}
          {vehicleDetailsSubTab === "obtained" && (
            <div className="space-y-4">
              {obtainedVehicles.length === 0 ? (
                <div className="py-12 text-center rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 p-6">
                  <Key className="mx-auto h-8 w-8 text-slate-400" />
                  <h4 className="mt-2 text-sm font-bold text-slate-900 dark:text-white">
                    No Rental Bookings Yet
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">
                    You have not submitted any vehicle dispatch or rental requests yet.
                  </p>
                  <button
                    type="button"
                    onClick={() => handleSelectorChange("get")}
                    className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 transition cursor-pointer"
                  >
                    <Search size={14} />
                    <span>Search Fleet Available</span>
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {obtainedVehicles.map((req) => (
                    <div
                      key={req.id}
                      className="py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-slate-50/50 dark:hover:bg-slate-800/40 rounded-xl px-2 transition"
                    >
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 rounded-lg bg-indigo-50 p-2 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
                          <Key size={18} />
                        </span>
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="text-sm font-bold text-slate-900 dark:text-white">{req.vehicleTitle}</h4>
                            <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
                              {req.status}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            Route: <strong>{req.sourceLocation} → {req.destinationLocation}</strong> • Pickup: {req.pickupDate} ({req.rentalDuration})
                          </p>
                          <p className="mt-1 text-[11px] text-slate-500">
                            Cargo: {req.cargoType} • Driver: {req.driverRequired ? "Included" : "Without"}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between md:justify-end gap-4">
                        <div className="text-right">
                          <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400 font-mono">
                            ₹ {req.offeredPrice.toLocaleString()}
                          </span>
                          <span className="block text-[10px] text-slate-400">{req.priceUnit}</span>
                        </div>
                        <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-3 py-1 text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                          ID: {req.id}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* VIEW 5: HELP VIEW */}
      {activeTab === "help" && (
        <div className="space-y-6 rounded-3xl border border-slate-200/80 bg-white/95 p-6 sm:p-8 shadow-xl backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/95 mt-3 sm:mt-6 md:mt-8 lg:mt-10">
          <div className="border-b border-slate-100 pb-5 dark:border-slate-800">
            <div className="inline-flex items-center gap-2 rounded-full bg-purple-50 px-3 py-1 text-xs font-bold text-purple-600 dark:bg-purple-950/60 dark:text-purple-400">
              <HelpCircle size={14} />
              <span>LOGISTICS SUPPORT & COMPLIANCE</span>
            </div>
            <h2 className="mt-2 text-xl font-bold text-slate-900 dark:text-white">Logistics & Fleet FAQs</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Regulatory guidelines, dispatch operations, and dispute assistance under Indian transport law.
            </p>
          </div>

          <div className="space-y-4 text-xs">
            <div className="rounded-2xl border border-slate-200/80 p-4 dark:border-slate-800">
              <h4 className="font-bold text-sm text-slate-900 dark:text-white">
                What documents are mandatory to lend a vehicle on Gleska?
              </h4>
              <p className="mt-1 text-slate-600 dark:text-slate-400 leading-relaxed">
                Under the Indian Motor Vehicles Act, 1988, every commercial transport vehicle must have a valid Registration Certificate (RC), Commercial Fitness Certificate (Form 38), and Third-Party or Comprehensive Commercial Insurance. An All-India National Permit (Form 48) is required for interstate routes.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/80 p-4 dark:border-slate-800">
              <h4 className="font-bold text-sm text-slate-900 dark:text-white">
                How does dispatch matching work in Get Vehicle?
              </h4>
              <p className="mt-1 text-slate-600 dark:text-slate-400 leading-relaxed">
                Get Vehicle matches your pickup hub, cargo weight requirements, and budget against real verified vehicles listed by participating companies and logistics operators. Once you submit a rental request, the vehicle owner is notified to review and coordinate dispatch.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/80 p-4 dark:border-slate-800">
              <h4 className="font-bold text-sm text-slate-900 dark:text-white">
                Are e-Way bills generated automatically?
              </h4>
              <p className="mt-1 text-slate-600 dark:text-slate-400 leading-relaxed">
                Gleska Logistics provides pre-formatted consignment and vehicle registration details to integrate with the GST e-Way Bill portal for shipments exceeding ₹50,000 value.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 6: SETTINGS (AUTHENTICATED COMPANY PROFILE & PREFERENCES) */}
      {activeTab === "settings" && (
        <div className="space-y-6 rounded-3xl border border-slate-200/80 bg-white/95 p-6 sm:p-8 shadow-xl backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/95 mt-3 sm:mt-6 md:mt-8 lg:mt-10">
          <div className="border-b border-slate-100 pb-5 dark:border-slate-800">
            <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              <Settings size={14} />
              <span>COMPANY PROFILE & PREFERENCES</span>
            </div>
            <h2 className="mt-2 text-xl font-bold text-slate-900 dark:text-white">
              Logistics Company Settings
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Manage your company information, registered dispatch address, and operational logistics preferences.
            </p>
          </div>

          {settingsLoading ? (
            <div className="py-12 text-center text-slate-500">
              <RefreshCw className="h-6 w-6 animate-spin mx-auto text-emerald-600" />
              <p className="mt-2 text-xs font-semibold">Loading company profile from Gleska backend...</p>
            </div>
          ) : (
            <form onSubmit={handleSaveSettings} className="space-y-6 max-w-2xl text-xs">
              {/* Account summary banner */}
              <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/40 flex items-center justify-between">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400">Account Classification</span>
                  <p className="font-bold text-slate-900 dark:text-white">
                    {settingsForm.employerType ? settingsForm.employerType.replace(/_/g, " ") : "Registered Employer"}
                  </p>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400">Verification</span>
                  <p className="font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 size={13} />
                    <span>{settingsForm.verificationStatus || "Active Verified"}</span>
                  </p>
                </div>
              </div>

              {/* Company Details */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  Business & Contact Identification
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Company / Business Legal Name
                    </label>
                    <input
                      type="text"
                      value={settingsForm.businessName}
                      onChange={(e) => setSettingsForm({ ...settingsForm, businessName: e.target.value })}
                      placeholder="e.g. Acme Industrial Logistics Ltd"
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Authorized Contact Person
                    </label>
                    <input
                      type="text"
                      value={settingsForm.contactPersonName}
                      onChange={(e) => setSettingsForm({ ...settingsForm, contactPersonName: e.target.value })}
                      placeholder="Full Name"
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Company Email Address
                    </label>
                    <input
                      type="email"
                      value={settingsForm.companyEmail}
                      onChange={(e) => setSettingsForm({ ...settingsForm, companyEmail: e.target.value })}
                      placeholder="contact@company.com"
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Contact Phone / Mobile
                    </label>
                    <input
                      type="text"
                      value={settingsForm.companyPhone}
                      onChange={(e) => setSettingsForm({ ...settingsForm, companyPhone: e.target.value })}
                      placeholder="+91 98XXX XXXXX"
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    />
                  </div>
                </div>
              </div>

              {/* Registered Location */}
              <div className="space-y-4 pt-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  Registered Dispatch & Operating Address
                </h3>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Registered Street Address
                  </label>
                  <input
                    type="text"
                    value={settingsForm.address}
                    onChange={(e) => setSettingsForm({ ...settingsForm, address: e.target.value })}
                    placeholder="Plot / Shed / Industrial Area Address"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">City</label>
                    <input
                      type="text"
                      value={settingsForm.city}
                      onChange={(e) => setSettingsForm({ ...settingsForm, city: e.target.value })}
                      placeholder="City"
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">State</label>
                    <input
                      type="text"
                      value={settingsForm.state}
                      onChange={(e) => setSettingsForm({ ...settingsForm, state: e.target.value })}
                      placeholder="State"
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">PIN Code</label>
                    <input
                      type="text"
                      maxLength={6}
                      value={settingsForm.pincode}
                      onChange={(e) => setSettingsForm({ ...settingsForm, pincode: e.target.value })}
                      placeholder="6-digit PIN"
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 font-mono font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    />
                  </div>
                </div>
              </div>

              {/* Notification Preferences */}
              <div className="space-y-3 pt-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  Fleet Notification Preferences
                </h3>

                <div className="flex items-center justify-between rounded-xl border border-slate-200 p-3.5 dark:border-slate-700">
                  <div>
                    <p className="font-bold text-slate-900 dark:text-white">Dispatch Inquiries & Alerts</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Notify by email/SMS when a shipper requests one of your lent vehicles.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={settingsForm.dispatchAlerts}
                    onChange={(e) => setSettingsForm({ ...settingsForm, dispatchAlerts: e.target.checked })}
                    className="h-4 w-4 accent-emerald-600 cursor-pointer"
                  />
                </div>

                <div className="flex items-center justify-between rounded-xl border border-slate-200 p-3.5 dark:border-slate-700">
                  <div>
                    <p className="font-bold text-slate-900 dark:text-white">Trip Status Updates</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Receive live milestone and delivery transit status updates.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={settingsForm.tripStatusUpdates}
                    onChange={(e) => setSettingsForm({ ...settingsForm, tripStatusUpdates: e.target.checked })}
                    className="h-4 w-4 accent-emerald-600 cursor-pointer"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-4 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="submit"
                  disabled={settingsSaving}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-6 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60 transition cursor-pointer"
                >
                  {settingsSaving && <RefreshCw size={14} className="animate-spin" />}
                  <span>{settingsSaving ? "Saving..." : "Save Company Settings"}</span>
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </AgentLayout>
  );
}
