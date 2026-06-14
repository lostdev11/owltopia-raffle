-- Link Owl Center generator project to a launch (Gen2 asset pipeline).

ALTER TABLE public.owl_center_launches
  ADD COLUMN IF NOT EXISTS generator_project_id text;

COMMENT ON COLUMN public.owl_center_launches.generator_project_id IS
  'Optional Owl Generator project UUID — used for Gen2 export-and-stage workflow.';

CREATE INDEX IF NOT EXISTS idx_owl_center_launches_generator_project
  ON public.owl_center_launches (generator_project_id)
  WHERE generator_project_id IS NOT NULL AND generator_project_id <> '';
