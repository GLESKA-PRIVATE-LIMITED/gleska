"use client";

import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  FileText,
  Scan,
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
  DollarSign,
  Building2,
  Calendar,
  ShieldCheck,
  AlertCircle,
  Trash2,
  Download,
  Receipt,
  Sparkles,
  FileCheck,
  CreditCard,
  FileSpreadsheet,
  Check,
  RefreshCw,
} from "lucide-react";
import AgentLayout from "@/components/agent-dashboard/AgentLayout";
import { financialConfig } from "@/components/agents/financial/financialConfig";

// Supported file formats for upload
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

interface FinancialRecord {
  id: string;
  type: "INVOICE" | "TRANSACTION" | "AUDIT" | "VENDOR";
  title: string;
  entity: string;
  reference: string;
  amount?: string;
  status: "Paid" | "Pending" | "Overdue" | "Completed" | "Passed" | "Active";
  date: string;
  category: string;
}

const INITIAL_FINANCIAL_RECORDS: FinancialRecord[] = [
  {
    id: "rec-1",
    type: "INVOICE",
    title: "Heavy Machinery Fabrication & Assembly",
    entity: "Tata Steel Ltd",
    reference: "INV-2024-001",
    amount: "₹ 4,85,000",
    status: "Paid",
    date: "12 Oct 2024",
    category: "Industrial Equipment",
  },
  {
    id: "rec-2",
    type: "INVOICE",
    title: "Structural Steel Flanges Delivery",
    entity: "Larsen & Toubro",
    reference: "INV-2024-002",
    amount: "₹ 12,40,000",
    status: "Pending",
    date: "24 Oct 2024",
    category: "Structural Steel",
  },
  {
    id: "rec-3",
    type: "INVOICE",
    title: "Boiler Pipeline High-Pressure Fittings",
    entity: "JSW Energy Ltd",
    reference: "INV-2024-003",
    amount: "₹ 3,20,000",
    status: "Overdue",
    date: "05 Oct 2024",
    category: "Pipeline Components",
  },
  {
    id: "rec-4",
    type: "INVOICE",
    title: "Turbine Rotor Sealing Gaskets",
    entity: "Bharat Heavy Electricals (BHEL)",
    reference: "INV-2024-004",
    amount: "₹ 8,95,000",
    status: "Paid",
    date: "18 Sep 2024",
    category: "Turbine Parts",
  },
  {
    id: "rec-5",
    type: "TRANSACTION",
    title: "Vendor Payout: Industrial Wire Rods",
    entity: "Jindal Stainless",
    reference: "TXN-8821",
    amount: "₹ 2,15,000",
    status: "Completed",
    date: "10 Oct 2024",
    category: "Vendor Payout",
  },
  {
    id: "rec-6",
    type: "TRANSACTION",
    title: "GST Compliance Q3 CGST/SGST Remittance",
    entity: "Government Tax Portal",
    reference: "TXN-8822",
    amount: "₹ 1,42,800",
    status: "Completed",
    date: "08 Oct 2024",
    category: "Statutory Tax",
  },
  {
    id: "rec-7",
    type: "TRANSACTION",
    title: "Freight & Heavy Haulage Advance",
    entity: "FastTrack Logistics",
    reference: "TXN-8823",
    amount: "₹ 45,000",
    status: "Completed",
    date: "06 Oct 2024",
    category: "Logistics Advance",
  },
  {
    id: "rec-8",
    type: "AUDIT",
    title: "Statutory Corporate Tax & GST Compliance Audit",
    entity: "KPMG Advisory / Internal Audit Team",
    reference: "AUD-2024-Q3",
    status: "Passed",
    date: "30 Sep 2024",
    category: "Statutory Compliance (99.4%)",
  },
  {
    id: "rec-9",
    type: "AUDIT",
    title: "Vendor Purchase Order Reconciliation Audit",
    entity: "Gleska Automated Auditor",
    reference: "AUD-2024-Q2",
    status: "Passed",
    date: "30 Jun 2024",
    category: "Discrepancy 0.02%",
  },
  {
    id: "rec-10",
    type: "VENDOR",
    title: "Tier-1 Raw Material Supplier",
    entity: "Tata Steel Ltd",
    reference: "GSTIN: 27AAACT2727Q1ZW",
    status: "Active",
    date: "Verified",
    category: "Raw Material",
  },
  {
    id: "rec-11",
    type: "VENDOR",
    title: "Heavy EPC & Infrastructure Partner",
    entity: "Larsen & Toubro",
    reference: "GSTIN: 27AABCL0123M1Z9",
    status: "Active",
    date: "Verified",
    category: "EPC Contracting",
  },
  {
    id: "rec-12",
    type: "VENDOR",
    title: "High-Grade Stainless Steel Fabricator",
    entity: "Jindal Stainless",
    reference: "GSTIN: 06AAACJ8134Q1Z1",
    status: "Active",
    date: "Verified",
    category: "Metal Fabrication",
  },
];

interface AttachedDocument {
  name: string;
  size: string;
  type: string;
  source: "upload" | "camera" | "photo";
}

interface InvoiceItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
}

export default function FinancialDashboard() {
  const [activeTab, setActiveTab] = useState<string>("dashboard");
  const [selectedOption, setSelectedOption] = useState<"create" | "scan">("create");

  // Search state
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [executedSearchQuery, setExecutedSearchQuery] = useState<string>("");
  const [isPlusMenuOpen, setIsPlusMenuOpen] = useState<boolean>(false);
  const [isListening, setIsListening] = useState<boolean>(false);
  const [attachedFile, setAttachedFile] = useState<AttachedDocument | null>(null);

  // Toast feedback state
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);

  // Camera modal state
  const [showCameraModal, setShowCameraModal] = useState<boolean>(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);

  // Create Invoice state
  const [invoiceForm, setInvoiceForm] = useState({
    invoiceNumber: "INV-2024-005",
    clientName: "Premier Heavy Engineering Ltd",
    clientGst: "27AAACP9988K1Z3",
    issueDate: new Date().toISOString().split("T")[0],
    dueDate: new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0],
    taxRate: 18,
    notes: "Payment due within 30 days of invoice receipt.",
  });
  const [invoiceItems, setInvoiceItems] = useState<InvoiceItem[]>([
    { id: "1", description: "Precision CNC Milled Flanges (Grade 316)", quantity: 50, unitPrice: 2400 },
    { id: "2", description: "Industrial High-Pressure Seals", quantity: 100, unitPrice: 450 },
  ]);

  // Scan Invoice state
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scannedResult, setScannedResult] = useState<{
    vendorName: string;
    invoiceNo: string;
    totalAmount: string;
    taxAmount: string;
    date: string;
    confidence: string;
  } | null>(null);

  // Refs
  const plusMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const recognitionRef = useRef<any>(null);

  const showToast = (message: string, type: "success" | "error" | "info" = "info") => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 4000);
  };

  // Close plus dropdown menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (plusMenuRef.current && !plusMenuRef.current.contains(event.target as Node)) {
        setIsPlusMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
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

  // Synchronize selector changes with tabs if user clicks
  const handleSelectorChange = (optionId: "create" | "scan") => {
    setSelectedOption(optionId);
    if (optionId === "create") {
      setActiveTab("create-invoice");
    } else {
      setActiveTab("scan-invoice");
    }
  };

  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId);
    if (tabId === "create-invoice") {
      setSelectedOption("create");
    } else if (tabId === "scan-invoice") {
      setSelectedOption("scan");
    }
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
        "Invalid file type. Please select a supported document (PDF, DOCX, XLSX, CSV, or image).",
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

    showToast(`File uploaded: ${file.name} (${sizeFormatted})`, "success");
    setIsPlusMenuOpen(false);

    // If on scan tab, simulate scanning right away
    if (activeTab === "scan-invoice" || selectedOption === "scan") {
      runOcrSimulation(file.name);
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Choose Photo Handler
  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      showToast("Invalid file. Please select a valid photo or image file.", "error");
      if (photoInputRef.current) photoInputRef.current.value = "";
      return;
    }

    const sizeFormatted = `${Math.round(file.size / 1024)} KB`;
    setAttachedFile({
      name: file.name,
      size: sizeFormatted,
      type: "Photo Image",
      source: "photo",
    });

    showToast(`Photo selected: ${file.name}`, "success");
    setIsPlusMenuOpen(false);

    if (activeTab === "scan-invoice" || selectedOption === "scan") {
      runOcrSimulation(file.name);
    }

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
            "Camera permission was denied. Please allow camera permissions in browser settings.",
            "error"
          );
          return;
        } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
          showToast("No camera device found on this system. Opening image selector instead.", "info");
          cameraInputRef.current?.click();
          return;
        }
        // Fallback to native capture input
        cameraInputRef.current?.click();
      }
    } else {
      // Browser does not support getUserMedia or is in insecure context
      cameraInputRef.current?.click();
    }
  };

  // Native camera input fallback
  const handleCameraCaptureFallback = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const sizeFormatted = `${Math.round(file.size / 1024)} KB`;
    setAttachedFile({
      name: file.name || "Captured_Document_Photo.jpg",
      size: sizeFormatted,
      type: "Camera Capture",
      source: "camera",
    });

    showToast("Document photo captured successfully.", "success");
    if (activeTab === "scan-invoice" || selectedOption === "scan") {
      runOcrSimulation(file.name || "Captured Document");
    }
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
        const filename = `Document_Scan_${new Date().toISOString().slice(0, 10)}_${Math.floor(Math.random() * 1000)}.jpg`;
        setAttachedFile({
          name: filename,
          size: "450 KB",
          type: "Camera Capture (HD)",
          source: "camera",
        });
        showToast("Photo captured from camera successfully.", "success");
        closeCameraModal();
        if (activeTab === "scan-invoice" || selectedOption === "scan") {
          runOcrSimulation(filename);
        }
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
      recognition.lang = "en-US";

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
          showToast("No speech was detected. Please try speaking again.", "info");
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
      showToast("Unable to start speech recognition. Please check your browser microphone settings.", "error");
    }
  };

  // Search execution
  const executeSearch = () => {
    const query = searchQuery.trim();
    setExecutedSearchQuery(query);
    if (query) {
      showToast(`Showing financial results matching "${query}"`, "info");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      executeSearch();
    }
  };

  // OCR Simulation for Scanned Documents
  const runOcrSimulation = (fileName: string) => {
    setIsScanning(true);
    setScannedResult(null);
    setTimeout(() => {
      setIsScanning(false);
      setScannedResult({
        vendorName: "Bharat Precision Forgings Ltd",
        invoiceNo: `BPF-${Math.floor(1000 + Math.random() * 9000)}`,
        totalAmount: "₹ 3,45,200",
        taxAmount: "₹ 52,657 (18% GST)",
        date: new Date().toISOString().split("T")[0],
        confidence: "99.1% Confidence Score",
      });
      showToast(`Document "${fileName}" scanned and data extracted.`, "success");
    }, 1200);
  };

  // Dynamic filter results based on search
  const filteredRecords = useMemo(() => {
    const q = (executedSearchQuery || searchQuery).trim().toLowerCase();
    if (!q) return INITIAL_FINANCIAL_RECORDS;
    return INITIAL_FINANCIAL_RECORDS.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.entity.toLowerCase().includes(q) ||
        r.reference.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q) ||
        r.status.toLowerCase().includes(q) ||
        r.type.toLowerCase().includes(q)
    );
  }, [searchQuery, executedSearchQuery]);

  // Invoice calculations
  const invoiceSubtotal = useMemo(() => {
    return invoiceItems.reduce((acc, item) => acc + item.quantity * item.unitPrice, 0);
  }, [invoiceItems]);

  const invoiceTaxAmount = (invoiceSubtotal * invoiceForm.taxRate) / 100;
  const invoiceGrandTotal = invoiceSubtotal + invoiceTaxAmount;

  return (
    <AgentLayout
      config={financialConfig}
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
                <Camera size={20} className="text-indigo-400" />
                <h3 className="text-sm font-bold uppercase tracking-wider">Document Camera Scanner</h3>
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
              {/* Document Alignment Frame */}
              <div className="pointer-events-none absolute inset-6 rounded-xl border-2 border-dashed border-indigo-400/60" />
              <div className="pointer-events-none absolute bottom-3 left-0 right-0 text-center text-[11px] font-semibold text-white/80 bg-slate-900/60 py-1">
                Position document or receipt within the frame
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
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2 text-xs font-bold text-white shadow-lg shadow-indigo-600/30 hover:bg-indigo-500 active:scale-95 transition cursor-pointer"
              >
                <Camera size={16} />
                <span>Capture Document Photo</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SECTION 2 & 3: UPWARD FREED SPACE SELECTOR + COMPACT FUNCTIONAL SEARCH BAR */}
      {/* ========================================================================= */}
      <div className="flex flex-col items-center justify-center space-y-6 pt-2">
        {/* Compact Segmented Control (Create Invoice / Scan Invoice) */}
        <div className="inline-flex items-center rounded-full border border-slate-200/90 bg-white/95 p-1.5 shadow-sm backdrop-blur-md dark:border-slate-800/90 dark:bg-slate-900/95">
          <button
            type="button"
            onClick={() => handleSelectorChange("create")}
            className={`flex items-center gap-2 rounded-full px-5 py-2 text-xs sm:text-sm font-semibold transition-all duration-200 cursor-pointer ${
              selectedOption === "create"
                ? "bg-indigo-600 text-white font-bold shadow-xs dark:bg-indigo-600"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-100/70 dark:text-slate-300 dark:hover:text-white dark:hover:bg-slate-800/70"
            }`}
          >
            <FileText size={16} />
            <span>Create Invoice</span>
          </button>
          <button
            type="button"
            onClick={() => handleSelectorChange("scan")}
            className={`flex items-center gap-2 rounded-full px-5 py-2 text-xs sm:text-sm font-semibold transition-all duration-200 cursor-pointer ${
              selectedOption === "scan"
                ? "bg-indigo-600 text-white font-bold shadow-xs dark:bg-indigo-600"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-100/70 dark:text-slate-300 dark:hover:text-white dark:hover:bg-slate-800/70"
            }`}
          >
            <Scan size={16} />
            <span>Scan Invoice</span>
          </button>
        </div>

        {/* Compact Functional Search Bar Directly Below Selector */}
        <div className="relative mx-auto w-full max-w-2xl">
          <div className="relative flex items-center rounded-full border border-slate-200/90 bg-white/95 p-1.5 shadow-sm backdrop-blur-md transition-all focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/20 dark:border-slate-800 dark:bg-slate-900/95">
            {/* Left: Plus (+) Button & Dropdown Menu */}
            <div className="relative" ref={plusMenuRef}>
              <button
                type="button"
                onClick={() => setIsPlusMenuOpen(!isPlusMenuOpen)}
                className={`flex h-9 w-9 items-center justify-center rounded-full transition-all cursor-pointer ${
                  isPlusMenuOpen
                    ? "bg-indigo-600 text-white rotate-45"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white"
                }`}
                title="Add Document, Photo, or File"
                aria-label="Add Document or Photo"
              >
                <Plus size={18} />
              </button>

              {/* Plus Menu Popup */}
              {isPlusMenuOpen && (
                <div className="absolute left-0 top-12 z-50 w-56 rounded-2xl border border-slate-200/90 bg-white/95 p-1.5 shadow-2xl backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/95 animate-in fade-in zoom-in-95 duration-150">
                  <button
                    type="button"
                    onClick={() => {
                      setIsPlusMenuOpen(false);
                      fileInputRef.current?.click();
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800 transition text-left cursor-pointer"
                  >
                    <Upload size={16} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
                    <div>
                      <p className="font-bold">Upload File</p>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400">PDF, DOCX, XLSX, CSV, Images</p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={triggerTakePhoto}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800 transition text-left cursor-pointer"
                  >
                    <Camera size={16} className="text-purple-600 dark:text-purple-400 shrink-0" />
                    <div>
                      <p className="font-bold">Take Photo</p>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400">Capture document via camera</p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsPlusMenuOpen(false);
                      photoInputRef.current?.click();
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800 transition text-left cursor-pointer"
                  >
                    <ImageIcon size={16} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <div>
                      <p className="font-bold">Choose Photo</p>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400">Select image from device</p>
                    </div>
                  </button>
                </div>
              )}
            </div>

            {/* Center: Search Input */}
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search invoices, transactions, audits, vendors, or financial records..."
              className="flex-1 bg-transparent px-3 text-xs sm:text-sm font-medium text-slate-900 placeholder:text-slate-400 outline-none dark:text-white"
            />

            {/* Right: Listening Indicator + Mic + Search Action Buttons */}
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

              {/* Search Button */}
              <button
                type="button"
                onClick={executeSearch}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-600 text-white shadow-sm hover:bg-indigo-700 active:scale-95 transition cursor-pointer"
                title="Execute Search"
                aria-label="Search"
              >
                <Search size={16} />
              </button>
            </div>
          </div>

          {/* Attached Document Indicator Badge (if any) */}
          {attachedFile && (
            <div className="mt-2.5 flex items-center justify-between rounded-xl border border-indigo-200/90 bg-indigo-50/80 px-3.5 py-2 text-xs font-semibold text-indigo-900 dark:border-indigo-900/60 dark:bg-indigo-950/60 dark:text-indigo-200 animate-in fade-in">
              <div className="flex items-center gap-2 truncate">
                <FileCheck size={16} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
                <span className="truncate">
                  Attached: <strong>{attachedFile.name}</strong> ({attachedFile.size})
                </span>
                <span className="rounded-md bg-indigo-200/60 dark:bg-indigo-900/80 px-1.5 py-0.5 text-[10px] uppercase font-bold text-indigo-700 dark:text-indigo-300">
                  {attachedFile.source}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setAttachedFile(null)}
                className="ml-2 text-indigo-500 hover:text-indigo-800 dark:hover:text-white cursor-pointer"
                title="Remove attached file"
              >
                <X size={15} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* SEARCH RESULTS VIEW (when user is searching)                             */}
      {/* ========================================================================= */}
      {(searchQuery.trim().length > 0 || executedSearchQuery.length > 0) && (
        <section className="space-y-4 rounded-3xl border border-slate-200/80 bg-white/95 p-6 shadow-xl backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/95">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4 dark:border-slate-800">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Search Results ({filteredRecords.length})
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Matches for &ldquo;{searchQuery || executedSearchQuery}&rdquo; across invoices, transactions, audits, and vendors.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                setExecutedSearchQuery("");
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 transition cursor-pointer"
            >
              <RefreshCw size={13} />
              <span>Reset Search</span>
            </button>
          </div>

          {filteredRecords.length === 0 ? (
            <div className="py-12 text-center">
              <Search className="mx-auto h-8 w-8 text-slate-400" />
              <p className="mt-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
                No matching financial records found.
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Try searching by invoice number, company name, GSTIN, or transaction reference.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 overflow-x-auto dark:divide-slate-800">
              {filteredRecords.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3.5 hover:bg-slate-50/70 dark:hover:bg-slate-800/40 rounded-xl px-2 transition"
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={`mt-0.5 rounded-lg px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${
                        item.type === "INVOICE"
                          ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-300"
                          : item.type === "TRANSACTION"
                          ? "bg-purple-50 text-purple-700 dark:bg-purple-950/70 dark:text-purple-300"
                          : item.type === "AUDIT"
                          ? "bg-cyan-50 text-cyan-700 dark:bg-cyan-950/70 dark:text-cyan-300"
                          : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300"
                      }`}
                    >
                      {item.type}
                    </span>
                    <div>
                      <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                        {item.title}
                      </h4>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <span className="font-semibold text-slate-700 dark:text-slate-300">{item.entity}</span>
                        <span>•</span>
                        <span className="font-mono">{item.reference}</span>
                        <span>•</span>
                        <span>{item.category}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-4">
                    {item.amount && (
                      <span className="text-sm font-bold text-slate-900 dark:text-white font-mono">
                        {item.amount}
                      </span>
                    )}
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                        item.status === "Paid" || item.status === "Completed" || item.status === "Passed" || item.status === "Active"
                          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                          : item.status === "Pending"
                          ? "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                          : "bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"
                      }`}
                    >
                      {item.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ========================================================================= */}
      {/* SECTION 4: MAIN FINANCIAL FUNCTIONALITY TABS                              */}
      {/* ========================================================================= */}

      {/* VIEW: DASHBOARD OVERVIEW */}
      {activeTab === "dashboard" && (
        <div className="space-y-8">
          {/* Quick Metrics Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-2xl border border-slate-200/80 bg-white/95 p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/95">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Total Invoiced
                </span>
                <span className="rounded-lg bg-indigo-50 p-2 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
                  <FileText size={18} />
                </span>
              </div>
              <p className="mt-3 text-2xl font-bold text-slate-900 dark:text-white font-mono">₹ 29,40,000</p>
              <p className="mt-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                <span>↑ 14.2%</span> <span className="text-slate-400">vs last month</span>
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/80 bg-white/95 p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/95">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Pending Receivables
                </span>
                <span className="rounded-lg bg-amber-50 p-2 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400">
                  <Clock size={18} />
                </span>
              </div>
              <p className="mt-3 text-2xl font-bold text-slate-900 dark:text-white font-mono">₹ 15,60,000</p>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 font-semibold">
                2 active invoices awaiting clearance
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/80 bg-white/95 p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/95">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Audits Passed
                </span>
                <span className="rounded-lg bg-cyan-50 p-2 text-cyan-600 dark:bg-cyan-950/60 dark:text-cyan-400">
                  <ShieldCheck size={18} />
                </span>
              </div>
              <p className="mt-3 text-2xl font-bold text-slate-900 dark:text-white font-mono">100% Passed</p>
              <p className="mt-1 text-[11px] text-cyan-600 dark:text-cyan-400 font-semibold">
                99.4% average compliance rate
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/80 bg-white/95 p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/95">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Active Vendors
                </span>
                <span className="rounded-lg bg-emerald-50 p-2 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
                  <Building2 size={18} />
                </span>
              </div>
              <p className="mt-3 text-2xl font-bold text-slate-900 dark:text-white font-mono">28 Vendors</p>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 font-semibold">
                GSTIN verified & active accounts
              </p>
            </div>
          </div>

          {/* Recent Invoices & Activity Table */}
          <div className="rounded-3xl border border-slate-200/80 bg-white/95 p-6 shadow-xl backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/95">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4 dark:border-slate-800">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">Recent Invoices</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Live status of industrial customer invoices and payment collections.
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleSelectorChange("create")}
                className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-indigo-700 transition cursor-pointer"
              >
                <Plus size={14} />
                <span>New Invoice</span>
              </button>
            </div>

            <div className="mt-4 divide-y divide-slate-100 overflow-x-auto dark:divide-slate-800">
              {INITIAL_FINANCIAL_RECORDS.filter((r) => r.type === "INVOICE").map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center justify-between gap-4 py-3.5 hover:bg-slate-50/60 dark:hover:bg-slate-800/40 rounded-xl px-2 transition"
                >
                  <div className="flex items-center gap-3">
                    <span className="rounded-lg bg-indigo-50 p-2 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
                      <FileText size={18} />
                    </span>
                    <div>
                      <h4 className="text-sm font-bold text-slate-900 dark:text-white">{inv.title}</h4>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {inv.entity} • <span className="font-mono">{inv.reference}</span> • {inv.date}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <span className="text-sm font-bold text-slate-900 dark:text-white font-mono">{inv.amount}</span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                        inv.status === "Paid"
                          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                          : inv.status === "Pending"
                          ? "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                          : "bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"
                      }`}
                    >
                      {inv.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* VIEW: CREATE INVOICE */}
      {activeTab === "create-invoice" && (
        <div className="space-y-6 rounded-3xl border border-slate-200/80 bg-white/95 p-6 sm:p-8 shadow-xl backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/95">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-5 dark:border-slate-800">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
                <FileText size={14} />
                <span>INVOICE GENERATOR</span>
              </div>
              <h2 className="mt-2 text-xl font-bold text-slate-900 dark:text-white">Create Industrial Invoice</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Generate GST-compliant invoices for supply chain, machinery, and services.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  showToast("Invoice saved as draft.", "success");
                }}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 transition cursor-pointer"
              >
                Save Draft
              </button>
              <button
                type="button"
                onClick={() => {
                  showToast(`Invoice ${invoiceForm.invoiceNumber} generated and ready to send.`, "success");
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-5 py-2 text-xs font-bold text-white shadow-md shadow-indigo-600/30 hover:bg-indigo-700 transition cursor-pointer"
              >
                <Check size={14} />
                <span>Generate Invoice</span>
              </button>
            </div>
          </div>

          {/* Invoice Header Details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                Invoice Number
              </label>
              <input
                type="text"
                value={invoiceForm.invoiceNumber}
                onChange={(e) => setInvoiceForm({ ...invoiceForm, invoiceNumber: e.target.value })}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs sm:text-sm font-mono font-medium text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                Client / Company Name
              </label>
              <input
                type="text"
                value={invoiceForm.clientName}
                onChange={(e) => setInvoiceForm({ ...invoiceForm, clientName: e.target.value })}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs sm:text-sm font-medium text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                Issue Date
              </label>
              <input
                type="date"
                value={invoiceForm.issueDate}
                onChange={(e) => setInvoiceForm({ ...invoiceForm, issueDate: e.target.value })}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs sm:text-sm font-medium text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                Payment Due Date
              </label>
              <input
                type="date"
                value={invoiceForm.dueDate}
                onChange={(e) => setInvoiceForm({ ...invoiceForm, dueDate: e.target.value })}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs sm:text-sm font-medium text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>
          </div>

          {/* Line Items Table */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Invoice Line Items
              </h3>
              <button
                type="button"
                onClick={() => {
                  setInvoiceItems([
                    ...invoiceItems,
                    {
                      id: String(Date.now()),
                      description: "New Item / Industrial Service",
                      quantity: 1,
                      unitPrice: 1000,
                    },
                  ]);
                }}
                className="inline-flex items-center gap-1 text-xs font-bold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 cursor-pointer"
              >
                <Plus size={14} />
                <span>Add Item</span>
              </button>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-700">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 uppercase font-bold tracking-wider">
                  <tr>
                    <th className="p-3">Description</th>
                    <th className="p-3 w-24">Qty</th>
                    <th className="p-3 w-32">Rate (₹)</th>
                    <th className="p-3 w-32 text-right">Total (₹)</th>
                    <th className="p-3 w-12 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {invoiceItems.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                      <td className="p-3">
                        <input
                          type="text"
                          value={item.description}
                          onChange={(e) => {
                            setInvoiceItems(
                              invoiceItems.map((i) =>
                                i.id === item.id ? { ...i, description: e.target.value } : i
                              )
                            );
                          }}
                          className="w-full bg-transparent font-medium text-slate-900 outline-none dark:text-white"
                        />
                      </td>
                      <td className="p-3">
                        <input
                          type="number"
                          min="1"
                          value={item.quantity}
                          onChange={(e) => {
                            setInvoiceItems(
                              invoiceItems.map((i) =>
                                i.id === item.id ? { ...i, quantity: Number(e.target.value) || 0 } : i
                              )
                            );
                          }}
                          className="w-full bg-transparent font-mono font-medium text-slate-900 outline-none dark:text-white"
                        />
                      </td>
                      <td className="p-3">
                        <input
                          type="number"
                          min="0"
                          value={item.unitPrice}
                          onChange={(e) => {
                            setInvoiceItems(
                              invoiceItems.map((i) =>
                                i.id === item.id ? { ...i, unitPrice: Number(e.target.value) || 0 } : i
                              )
                            );
                          }}
                          className="w-full bg-transparent font-mono font-medium text-slate-900 outline-none dark:text-white"
                        />
                      </td>
                      <td className="p-3 text-right font-mono font-bold text-slate-900 dark:text-white">
                        ₹ {(item.quantity * item.unitPrice).toLocaleString()}
                      </td>
                      <td className="p-3 text-center">
                        {invoiceItems.length > 1 && (
                          <button
                            type="button"
                            onClick={() => {
                              setInvoiceItems(invoiceItems.filter((i) => i.id !== item.id));
                            }}
                            className="text-slate-400 hover:text-rose-600 transition cursor-pointer"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Invoice Summary */}
          <div className="flex flex-col sm:flex-row justify-between gap-6 border-t border-slate-100 pt-5 dark:border-slate-800">
            <div className="max-w-md w-full">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                Payment Terms & Notes
              </label>
              <textarea
                rows={2}
                value={invoiceForm.notes}
                onChange={(e) => setInvoiceForm({ ...invoiceForm, notes: e.target.value })}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-800 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              />
            </div>

            <div className="w-full sm:w-72 space-y-2 text-xs">
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>Subtotal:</span>
                <span className="font-mono font-semibold">₹ {invoiceSubtotal.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>GST ({invoiceForm.taxRate}%):</span>
                <span className="font-mono font-semibold">₹ {invoiceTaxAmount.toLocaleString()}</span>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-2 text-sm font-bold text-slate-900 dark:border-slate-700 dark:text-white">
                <span>Grand Total:</span>
                <span className="font-mono text-indigo-600 dark:text-indigo-400">
                  ₹ {invoiceGrandTotal.toLocaleString()}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* VIEW: SCAN INVOICE */}
      {activeTab === "scan-invoice" && (
        <div className="space-y-6 rounded-3xl border border-slate-200/80 bg-white/95 p-6 sm:p-8 shadow-xl backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/95">
          <div className="border-b border-slate-100 pb-5 dark:border-slate-800">
            <div className="inline-flex items-center gap-2 rounded-full bg-purple-50 px-3 py-1 text-xs font-bold text-purple-600 dark:bg-purple-950/60 dark:text-purple-400">
              <Scan size={14} />
              <span>INTELLIGENT OCR SCANNER</span>
            </div>
            <h2 className="mt-2 text-xl font-bold text-slate-900 dark:text-white">
              Scan & Process Vendor Bills
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Upload documents, take camera photos, or drag & drop vendor invoices to automatically extract data.
            </p>
          </div>

          {/* Document Dropzone & Capture Actions */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div
              onClick={() => fileInputRef.current?.click()}
              className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50/60 p-8 text-center transition hover:border-indigo-400 hover:bg-indigo-50/30 dark:border-slate-700 dark:bg-slate-800/40 dark:hover:border-indigo-500 cursor-pointer"
            >
              <div className="rounded-full bg-indigo-50 p-3 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
                <Upload size={24} />
              </div>
              <h4 className="mt-3 text-sm font-bold text-slate-900 dark:text-white">
                Upload Invoice File
              </h4>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                PDF, DOCX, XLSX, CSV, or Image (up to 25MB)
              </p>
              <button
                type="button"
                className="mt-4 rounded-xl bg-slate-200/70 px-4 py-1.5 text-xs font-bold text-slate-700 dark:bg-slate-700 dark:text-slate-200"
              >
                Browse Document
              </button>
            </div>

            <div
              onClick={triggerTakePhoto}
              className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50/60 p-8 text-center transition hover:border-purple-400 hover:bg-purple-50/30 dark:border-slate-700 dark:bg-slate-800/40 dark:hover:border-purple-500 cursor-pointer"
            >
              <div className="rounded-full bg-purple-50 p-3 text-purple-600 dark:bg-purple-950/60 dark:text-purple-400">
                <Camera size={24} />
              </div>
              <h4 className="mt-3 text-sm font-bold text-slate-900 dark:text-white">
                Capture via Camera
              </h4>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Take a direct photo of physical bills or receipts
              </p>
              <button
                type="button"
                className="mt-4 rounded-xl bg-slate-200/70 px-4 py-1.5 text-xs font-bold text-slate-700 dark:bg-slate-700 dark:text-slate-200"
              >
                Open Camera
              </button>
            </div>
          </div>

          {/* OCR Processing Loader / Result */}
          {isScanning && (
            <div className="flex items-center justify-center gap-3 rounded-2xl border border-indigo-200 bg-indigo-50/70 p-6 text-indigo-700 dark:border-indigo-900/60 dark:bg-indigo-950/60 dark:text-indigo-300">
              <RefreshCw size={18} className="animate-spin text-indigo-600" />
              <span className="text-xs font-bold uppercase tracking-wider">
                Analyzing invoice lines & extracting metadata with OCR...
              </span>
            </div>
          )}

          {scannedResult && !isScanning && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-5 dark:border-emerald-900/60 dark:bg-emerald-950/40">
              <div className="flex items-center justify-between border-b border-emerald-200/60 pb-3 dark:border-emerald-800/60">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-400" />
                  <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                    Data Successfully Extracted ({scannedResult.confidence})
                  </h4>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    showToast("Verified & Recorded in Financial Ledger", "success");
                    setScannedResult(null);
                  }}
                  className="rounded-xl bg-emerald-600 px-4 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 transition cursor-pointer"
                >
                  Verify & Record to Ledger
                </button>
              </div>

              <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                <div>
                  <span className="text-slate-500 dark:text-slate-400">Extracted Vendor:</span>
                  <p className="font-bold text-slate-900 dark:text-white">{scannedResult.vendorName}</p>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-slate-400">Invoice Number:</span>
                  <p className="font-mono font-bold text-slate-900 dark:text-white">{scannedResult.invoiceNo}</p>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-slate-400">Total Amount:</span>
                  <p className="font-mono font-bold text-emerald-600 dark:text-emerald-400">{scannedResult.totalAmount}</p>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-slate-400">Date:</span>
                  <p className="font-medium text-slate-900 dark:text-white">{scannedResult.date}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* VIEW: AUDITS TILL DATE */}
      {activeTab === "audits" && (
        <div className="space-y-6 rounded-3xl border border-slate-200/80 bg-white/95 p-6 sm:p-8 shadow-xl backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/95">
          <div className="border-b border-slate-100 pb-5 dark:border-slate-800">
            <div className="inline-flex items-center gap-2 rounded-full bg-cyan-50 px-3 py-1 text-xs font-bold text-cyan-600 dark:bg-cyan-950/60 dark:text-cyan-400">
              <ShieldCheck size={14} />
              <span>COMPLIANCE & RECONCILIATION</span>
            </div>
            <h2 className="mt-2 text-xl font-bold text-slate-900 dark:text-white">Audits Till Date</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Historical ledger reconciliation, GST compliance checks, and statutory audit logs.
            </p>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {INITIAL_FINANCIAL_RECORDS.filter((r) => r.type === "AUDIT").map((audit) => (
              <div key={audit.id} className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 rounded-lg bg-cyan-50 p-2 text-cyan-600 dark:bg-cyan-950/60 dark:text-cyan-400">
                    <ShieldCheck size={18} />
                  </span>
                  <div>
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white">{audit.title}</h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Ref: <span className="font-mono font-semibold">{audit.reference}</span> • Auditor: {audit.entity} • {audit.date}
                    </p>
                    <p className="mt-1 text-xs font-semibold text-cyan-600 dark:text-cyan-400">{audit.category}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                    {audit.status}
                  </span>
                  <button
                    type="button"
                    onClick={() => showToast(`Audit Report ${audit.reference} downloaded.`, "success")}
                    className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 transition cursor-pointer flex items-center gap-1.5"
                  >
                    <Download size={13} />
                    <span>Report</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* VIEW: SETTINGS */}
      {activeTab === "settings" && (
        <div className="space-y-6 rounded-3xl border border-slate-200/80 bg-white/95 p-6 sm:p-8 shadow-xl backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/95">
          <div className="border-b border-slate-100 pb-5 dark:border-slate-800">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">Financial Agent Settings</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Configure currency, tax parameters, and automated invoice reconciliation preferences.
            </p>
          </div>

          <div className="space-y-5 max-w-xl text-xs">
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                Base Operating Currency
              </label>
              <select className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                <option value="INR">INR (₹) — Indian Rupee</option>
                <option value="USD">USD ($) — United States Dollar</option>
                <option value="EUR">EUR (€) — Euro</option>
              </select>
            </div>

            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                Company GSTIN / Tax Identification
              </label>
              <input
                type="text"
                defaultValue="27AAACG1234M1Z5"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 font-mono font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              />
            </div>

            <div className="flex items-center justify-between rounded-xl border border-slate-200 p-3.5 dark:border-slate-700">
              <div>
                <p className="font-bold text-slate-900 dark:text-white">Auto-Reconcile Incoming Bills</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Automatically match scanned vendor bills against purchase orders.
                </p>
              </div>
              <input type="checkbox" defaultChecked className="h-4 w-4 accent-indigo-600 cursor-pointer" />
            </div>

            <button
              type="button"
              onClick={() => showToast("Financial settings saved successfully.", "success")}
              className="rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 transition cursor-pointer"
            >
              Save Settings
            </button>
          </div>
        </div>
      )}
    </AgentLayout>
  );
}
