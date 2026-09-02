import { useState } from "react";
import { supabase } from "@/lib/supabase";
import apiClient from "@/lib/api";

const MAX_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function useWorkerProfilePhoto() {
  const [isUploading, setIsUploading] = useState(false);

  const uploadPhoto = async (file: File, refreshUser: () => Promise<unknown>) => {
    if (!ALLOWED_TYPES.has(file.type)) throw new Error("Only JPG, PNG, and WEBP images are allowed");
    if (file.size === 0 || file.size > MAX_SIZE) throw new Error("Profile photo must be between 1 byte and 5MB");

    setIsUploading(true);
    try {
      const start = await apiClient.post<{ storage_path: string }>("/api/v1/workers/me/profile-photo/upload-start", {
        original_filename: file.name,
        mime_type: file.type,
        file_size_bytes: file.size,
      });
      const storagePath = start.data.storage_path;
      const { error } = await supabase.storage.from("profile-photos").upload(storagePath, file, {
        cacheControl: "3600",
        upsert: false,
      });
      if (error) throw new Error(`Profile photo upload failed: ${error.message}`);

      await apiClient.post("/api/v1/workers/me/profile-photo/upload-complete", {
        original_filename: file.name,
        mime_type: file.type,
        file_size_bytes: file.size,
        storage_path: storagePath,
      });
      await refreshUser();
    } finally {
      setIsUploading(false);
    }
  };

  return { isUploading, uploadPhoto };
}
