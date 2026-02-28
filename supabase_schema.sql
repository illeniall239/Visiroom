-- Create a bucket for storing room uploads and generated images
insert into storage.buckets (id, name, public) 
values ('visual-commerce', 'visual-commerce', true);

-- Allow public read access to the bucket
create policy "Public Access" 
on storage.objects for select 
using ( bucket_id = 'visual-commerce' );

-- Allow authenticated/anon inserts (adjust for production security)
create policy "Public Uploads" 
on storage.objects for insert 
with check ( bucket_id = 'visual-commerce' );

-- ==========================================
-- Example Tables for Database (Next Step)
-- ==========================================

-- Table to store generation history
CREATE TABLE generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_ip VARCHAR(255),
  original_image_url TEXT NOT NULL,
  generated_image_url TEXT,
  status VARCHAR(50) DEFAULT 'pending',
  prompt TEXT,
  cost DECIMAL(10,4) DEFAULT 0.0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);