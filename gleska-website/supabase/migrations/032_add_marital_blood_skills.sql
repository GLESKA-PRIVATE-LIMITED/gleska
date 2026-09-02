-- Add marital_status, blood_group, and skills to worker_profiles
ALTER TABLE public.worker_profiles
  ADD COLUMN IF NOT EXISTS marital_status TEXT,
  ADD COLUMN IF NOT EXISTS blood_group TEXT,
  ADD COLUMN IF NOT EXISTS skills TEXT[];

-- Add constraints for valid values
ALTER TABLE public.worker_profiles
  ADD CONSTRAINT worker_profiles_marital_status_check
  CHECK (marital_status IS NULL OR marital_status IN ('Unmarried', 'Married', 'Divorced', 'Widowed', 'Separated'));

ALTER TABLE public.worker_profiles
  ADD CONSTRAINT worker_profiles_blood_group_check
  CHECK (blood_group IS NULL OR blood_group IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'));
