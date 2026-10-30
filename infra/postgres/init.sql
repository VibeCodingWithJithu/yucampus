-- Local development only. The API connects as this role, so row-level security applies to it.
-- Table privileges and policies are granted by the Prisma migrations.
CREATE ROLE yucampus_app LOGIN PASSWORD 'yucampus_app';
