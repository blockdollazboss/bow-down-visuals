import { createClient } from "@supabase/supabase-js";

async function run() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabase = createClient(url, key);

  const email = 'qa-tester@bowdownvisuals.test';
  
  // 1. User ID
  const { data: authData } = await supabase.auth.admin.listUsers();
  const user = authData?.users.find(u => u.email === email);
  const userId = user?.id;
  console.log("USER_ID:", userId);

  if (!userId) return;

  // 2. Projects and Columns
  const { data: projects } = await supabase.from('projects').select('*').eq('user_id', userId);
  console.log("PROJECTS_COUNT:", projects?.length || 0);
  if (projects?.[0]) {
      console.log("PROJECTS_COLUMNS:", Object.keys(projects[0]).join(', '));
  }

  // 3. Clip Counts
  for (const project of projects || []) {
      const scenes = project.output_data?.scenes || [];
      const jsonClips = scenes.filter(s => s.demoClipUrl || s.clipId || s.video_url).length;
      console.log(`PROJECT_RESULT: id=${project.id} title="${project.title}" json_clip_count=${jsonClips}`);
  }
}
run();
