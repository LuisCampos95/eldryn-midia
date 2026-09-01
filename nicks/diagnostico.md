# Diagnostico da qualificacao de fontes

```
charset=letras+numeros max_rps=8 trabalhadores=8
candidatas: 30 (sonda: 18)
--- https://accounts.hytale.com./{n}
    kkk -> disp=null [200 sem-json:200] <!DOCTYPE html><html lang="en"> <head><meta charset="UTF-8"><meta name="viewport" content="width=dev
--- https://accounts.hytale.com.?username={n}
    kkk -> disp=null [200 sem-json:200] <!DOCTYPE html><html lang="en"> <head><meta charset="UTF-8"><meta name="viewport" content="width=dev
--- https://accounts.hytale.com/api/account/username-reservations/availability/{n}
    kkk -> disp=null [200 sem-json:200] <!DOCTYPE html><html lang="en"> <head><meta charset="UTF-8"><meta name="viewport" content="width=dev
--- https://accounts.hytale.com/api/account/username-reservations/availability?username={n}
    kkk -> disp=null [200 sem-json:200] <!DOCTYPE html><html lang="en"> <head><meta charset="UTF-8"><meta name="viewport" content="width=dev
--- https://backend.accounts.hytale.com/{n}
    kkk -> disp=true [404 404-sem-json] 404 page not found 
--- https://backend.accounts.hytale.com?username={n}
    kkk -> disp=true [404 404-sem-json] 404 page not found 
--- https://backend.accounts.hytale.com/self-service/login/{n}
    kkk -> disp=true [404 404-sem-json] 404 page not found 
--- https://backend.accounts.hytale.com/self-service/login?username={n}
    kkk -> disp=null [400 bool=null] {"error":{"code":400,"status":"Bad Request","reason":"The flow query parameter is missing or malform
--- https://backend.accounts.hytale.com/self-service/login/browser/{n}
    kkk -> disp=true [404 404-sem-json] 404 page not found 
--- https://backend.accounts.hytale.com/self-service/login/browser?username={n}
    kkk -> disp=null [200 bool=null] {"id":"834194b7-7c6b-4bfc-9634-e689ff74de5c","organization_id":null,"type":"browser","expires_at":"2
--- https://github.com/DRagssss/hytale-api/{n}
    kkk -> disp=null [404 bool=null] {"error":"Not Found"}
--- https://github.com/DRagssss/hytale-api?username={n}
    kkk -> disp=true [200 bool=true] {"meta":{"title":"GitHub - DRagssss/hytale-api: Hytale API Python wrapper"},"payload":{"codeViewRepo
--- https://github.com/DRagssss/hytale-api.git/{n}
    kkk -> disp=null [404 bool=null] {"error":"Not Found"}
--- https://github.com/DRagssss/hytale-api.git?username={n}
    kkk -> disp=true [200 bool=true] {"meta":{"title":"GitHub - DRagssss/hytale-api: Hytale API Python wrapper"},"payload":{"codeViewRepo
--- https://github.com/DRagssss/hytale-api/issues/{n}
    kkk -> disp=null [406 sem-json:406] 
--- https://github.com/DRagssss/hytale-api/issues?username={n}
    kkk -> disp=null [406 sem-json:406] 
--- https://github.com/hytale-tools/api/{n}
    kkk -> disp=null [404 bool=null] {"error":"Not Found"}
--- https://github.com/hytale-tools/api?username={n}
    kkk -> disp=true [200 bool=true] {"meta":{"title":"GitHub - hytale-tools/api"},"payload":{"codeViewRepoRoute":{"path":"/","refInfo":{
--- https://hytale.tools/api/search/{n}
    kkk -> disp=null [500 bool=null] {"error":"Only HTML requests are supported here"}
--- https://hytale.tools/api/username/{n}
    kkk -> disp=null [500 bool=null] {"error":"Only HTML requests are supported here"}
--- https://hytale.tools/api/check/{n}
    kkk -> disp=null [500 bool=null] {"error":"Only HTML requests are supported here"}
--- https://api.hytale.tools/search/{n}
    kkk -> disp=true [404 404-sem-json] Not Found
--- https://api.hytale.tools/username/{n}
    kkk -> disp=true [404 404-sem-json] Not Found
--- https://api.hytale.tools/check/{n}
    kkk -> disp=true [404 404-sem-json] Not Found
--- https://hytl.tools/api/player/{n}
    kkk -> disp=null [500 bool=null] {"error":"Only HTML requests are supported here"}
--- https://api.hytl.tools/player/{n}
    kkk -> disp=true [404 404-sem-json] Not Found
--- https://accounts.hytale.com/api/username/available?username={n}
    kkk -> disp=null [200 sem-json:200] <!DOCTYPE html><html lang="en"> <head><meta charset="UTF-8"><meta name="viewport" content="width=dev
--- https://api.hytale.com/username/available?username={n}
    kkk -> disp=null [0 rede:fetch failed] 
--- https://account-data.hytale.com/username/{n}
    kkk -> disp=true [404 404-sem-json] 404 page not found 
--- https://playerdb.co/api/player/hytale/{n}
    kkk -> disp=true [400 hytale.not_found] {"message":"No Hytale player could be found with the given identifier.","code":"hytale.not_found","d
```
NENHUMA fonte qualificada.
