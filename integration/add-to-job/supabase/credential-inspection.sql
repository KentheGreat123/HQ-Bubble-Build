select r.rolname,r.rolcanlogin,r.rolsuper,r.rolinherit,r.rolcreaterole,
 r.rolcreatedb,r.rolreplication,r.rolbypassrls,r.rolconnlimit,r.rolvaliduntil,
 (r.rolvaliduntil is not null and r.rolvaliduntil<now()) password_expired,
 r.rolconfig,
 (select json_agg(json_build_object('role',p.rolname,'admin_option',m.admin_option,
  'inherit_option',m.inherit_option,'set_option',m.set_option))
 from pg_auth_members m join pg_roles p on p.oid=m.roleid where m.member=r.oid) memberships
from pg_roles r where r.rolname like 'cli_login_%' order by r.rolname;
