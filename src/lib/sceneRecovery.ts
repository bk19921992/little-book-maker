import type {PlanResponse} from '../types.ts';
// Clone the HTTP response so ordinary error handling can still inspect it.
export async function recoverSceneDraft(error:unknown):Promise<PlanResponse|null>{
 try{const response=(error as {context?:Response})?.context;const b=await response?.clone().json();
 if(b?.code!=='SCENE_PLAN_REVIEW_REQUIRED'||!b.draftOutline||!Array.isArray(b.draftOutline.pages)||!b.styleBible||!Array.isArray(b.issues))return null;
 return {outline:b.draftOutline,styleBible:b.styleBible,format:b.format,needsSceneRepair:true,issues:b.issues};
 }catch{return null}
}
