export async function initializeGroupPictures(db,database){
 const c=await db.getConnection(),lock=('mv-group-pictures-'+database).slice(0,64);let acquired=false;
 try{
  const [[result]]=await c.execute('SELECT GET_LOCK(?,10) AS acquired',[lock]);
  acquired=Number(result.acquired)===1;if(!acquired)throw new Error('Group picture migration is busy. Retry startup.');
  const [columns]=await c.query("SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='community_groups' AND COLUMN_NAME='image'");
  if(!columns.length)await c.query("ALTER TABLE community_groups ADD COLUMN image VARCHAR(1000) NOT NULL DEFAULT ''");
 }finally{try{if(acquired)await c.execute('SELECT RELEASE_LOCK(?)',[lock]);}finally{c.release();}}
}
