import { createClient } from "@supabase/supabase-js";

async function run() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabase = createClient(url, key);

  const userId = 'a2f7d4ae-71df-4099-b913-fbf66ffee668';
  
  const { data: projects } = await supabase.from('projects').select('*').eq('user_id', userId);
  
  if (!projects) {
      console.log("No projects found");
      return;
  }

  for (const project of projects) {
      console.log("---");
      console.log(`PROJECT_ID: ${project.id}`);
      console.log(`TITLE: ${project.title}`);
      
      const inputData = project.input_data || {};
      const outputData = project.output_data || {};
      
      console.log(`DURATION: ${inputData.duration || 'N/A'}`);
      console.log(`AUDIO_URL: ${inputData.audioUrl || outputData.audioUrl || 'N/A'}`);
      
      const scenes = outputData.scenes || [];
      console.log(`SCENE_COUNT: ${scenes.length}`);
      
      scenes.forEach((scene, i) => {
          if (scene.demoClipUrl || scene.clipId || scene.video_url) {
              console.log(`  SCENE ${i+1}: demoClipUrl=${scene.demoClipUrl || 'N/A'}, clipId=${scene.clipId || 'N/A'}, video_url=${scene.video_url || 'N/A'}`);
          }
      });
  }
}
run();
