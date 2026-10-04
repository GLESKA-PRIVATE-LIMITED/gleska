import { useState } from "react";
import axios from "axios";
import { supabase } from "@/lib/supabase";
import apiClient from "@/lib/api";

const MAX_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const PROFILE_PHOTOS_BUCKET = "profile-photos";

interface ProfilePhotoUploadStart {
  storage_path: string;
}

interface ProfilePhotoResponse {
  profile_photo_url: string | null;
}

async function withRefreshedSession<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (!axios.isAxiosError(error) || error.response?.status !== 401) {
      throw error;
    }
    const { data, error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError || !data.session) {
      throw error;
    }
    return request();
  }
}

export function useEmployerProfilePhoto() {
  const [isUploading, setIsUploading] = useState(false);

  const uploadPhoto = async (file: File): Promise<string> => {
    if (!ALLOWED_TYPES.has(file.type)) {
      throw new Error("Only JPG, PNG, and WEBP images are allowed");
    }
    if (file.size === 0 || file.size > MAX_SIZE) {
      throw new Error("Profile photo must be between 1 byte and 5MB");
    }

    setIsUploading(true);
    let storagePath: string | null = null;
    let completionRequested = false;
    try {
      const uploadMetadata = {
        original_filename: file.name,
        mime_type: file.type,
        file_size_bytes: file.size,
      };
      const start = await withRefreshedSession(() =>
        apiClient.post<ProfilePhotoUploadStart>(
          "/api/v1/employers/me/profile-photo/upload-start",
          uploadMetadata,
          { withCredentials: true },
        ),
      );
      storagePath = start.data.storage_path;
      const { error: uploadError } = await supabase.storage
        .from(PROFILE_PHOTOS_BUCKET)
        .upload(storagePath, file, { cacheControl: "3600", upsert: false });
      if (uploadError) {
        throw new Error(`Profile photo upload failed: ${uploadError.message}`);
      }

      completionRequested = true;
      const complete = await withRefreshedSession(() =>
        apiClient.post<ProfilePhotoResponse>(
          "/api/v1/employers/me/profile-photo/upload-complete",
          { ...uploadMetadata, storage_path: storagePath },
          { withCredentials: true },
        ),
      );
      if (!complete.data.profile_photo_url) {
        throw new Error("The profile photo was uploaded but could not be retrieved");
      }
      return complete.data.profile_photo_url;
    } catch (error) {
      const rejectedBeforePersistence =
        axios.isAxiosError(error) &&
        error.response?.status !== undefined &&
        error.response.status >= 400 &&
        error.response.status < 500;
      if (storagePath && (!completionRequested || rejectedBeforePersistence)) {
        const { error: cleanupError } = await supabase.storage
          .from(PROFILE_PHOTOS_BUCKET)
          .remove([storagePath]);
        if (cleanupError) {
          console.error("Unable to clean up incomplete employer profile photo upload", cleanupError);
        }
      }
      throw error;
    } finally {
      setIsUploading(false);
    }
  };

  const removePhoto = async (): Promise<void> => {
    setIsUploading(true);
    try {
      await withRefreshedSession(() =>
        apiClient.delete("/api/v1/employers/me/profile-photo", { withCredentials: true }),
      );
    } finally {
      setIsUploading(false);
    }
  };

  return { isUploading, uploadPhoto, removePhoto };
}
