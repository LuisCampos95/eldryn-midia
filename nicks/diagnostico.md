# Diagnostico da qualificacao de fontes

```
charset=letras+numeros max_rps=8 trabalhadores=8
candidatas: 20
--- https://accounts.hytale.com/api/account/username-reservations/availability?username={n} [servidor]
    kkk -> disp=null [200 200-html-spa] <!DOCTYPE html><html lang="en"> <head><meta charset="UTF-8"><meta name="viewport" content="width=dev
--- https://accounts.hytale.com/api/account/username-reservations/availability?username={n} [cru]
    kkk -> disp=null [200 200-html-spa] <!DOCTYPE html><html lang="en"> <head><meta charset="UTF-8"><meta name="viewport" content="width=dev
--- https://accounts.hytale.com/api/account/username-reservations/availability?username={n} [xhr]
    kkk -> disp=null [200 200-html-spa] <!DOCTYPE html><html lang="en"> <head><meta charset="UTF-8"><meta name="viewport" content="width=dev
--- https://backend.accounts.hytale.com/api/account/username-reservations/availability?username={n} [servidor]
    kkk -> disp=false [404 st404] 404 page not found 
    bob -> disp=false [404 st404] 404 page not found 
    kry -> disp=false [404 st404] 404 page not found 
    cherryjimbo -> disp=false [404 st404] 404 page not found 
    amostra de 30 aleatorios: livres=0 nulos=0 ex-livres=
    reprovada na amostra
--- https://backend.accounts.hytale.com/api/account/username-reservations/availability?username={n} [cru]
    kkk -> disp=false [404 st404] 404 page not found 
    bob -> disp=false [404 st404] 404 page not found 
    kry -> disp=false [404 st404] 404 page not found 
    cherryjimbo -> disp=false [404 st404] 404 page not found 
    amostra de 30 aleatorios: livres=0 nulos=0 ex-livres=
    reprovada na amostra
--- https://backend.accounts.hytale.com/api/account/username-reservations/availability?username={n} [xhr]
    kkk -> disp=false [404 st404] 404 page not found 
    bob -> disp=false [404 st404] 404 page not found 
    kry -> disp=false [404 st404] 404 page not found 
    cherryjimbo -> disp=false [404 st404] 404 page not found 
    amostra de 30 aleatorios: livres=0 nulos=0 ex-livres=
    reprovada na amostra
--- https://backend.accounts.hytale.com/account/username-reservations/availability?username={n} [servidor]
    kkk -> disp=false [404 st404] 404 page not found 
    bob -> disp=false [404 st404] 404 page not found 
    kry -> disp=false [404 st404] 404 page not found 
    cherryjimbo -> disp=false [404 st404] 404 page not found 
    amostra de 30 aleatorios: livres=0 nulos=0 ex-livres=
    reprovada na amostra
--- https://backend.accounts.hytale.com/account/username-reservations/availability?username={n} [cru]
    kkk -> disp=false [404 st404] 404 page not found 
    bob -> disp=false [404 st404] 404 page not found 
    kry -> disp=false [404 st404] 404 page not found 
    cherryjimbo -> disp=false [404 st404] 404 page not found 
    amostra de 30 aleatorios: livres=0 nulos=0 ex-livres=
    reprovada na amostra
--- https://backend.accounts.hytale.com/account/username-reservations/availability?username={n} [xhr]
    kkk -> disp=false [404 st404] 404 page not found 
    bob -> disp=false [404 st404] 404 page not found 
    kry -> disp=false [404 st404] 404 page not found 
    cherryjimbo -> disp=false [404 st404] 404 page not found 
    amostra de 30 aleatorios: livres=0 nulos=0 ex-livres=
    reprovada na amostra
--- https://accounts.hytale.com/{n} [json]
    kkk -> disp=null [200 sem-json:200] <!DOCTYPE html><html lang="en"> <head><meta charset="UTF-8"><meta name="viewport" content="width=dev
--- https://accounts.hytale.com?username={n} [json]
    kkk -> disp=null [200 sem-json:200] <!DOCTYPE html><html lang="en"> <head><meta charset="UTF-8"><meta name="viewport" content="width=dev
--- https://accounts.hytale.com/api/account/username-reservations/availability/{n} [json]
    kkk -> disp=null [200 sem-json:200] <!DOCTYPE html><html lang="en"> <head><meta charset="UTF-8"><meta name="viewport" content="width=dev
--- https://accounts.hytale.com/api/account/username-reservations/availability?username={n} [json]
    kkk -> disp=null [200 sem-json:200] <!DOCTYPE html><html lang="en"> <head><meta charset="UTF-8"><meta name="viewport" content="width=dev
--- https://backend.accounts.hytale.com/{n} [json]
    kkk -> disp=true [404 404-sem-json] 404 page not found 
--- https://backend.accounts.hytale.com?username={n} [json]
    kkk -> disp=true [404 404-sem-json] 404 page not found 
--- https://hytale.tools/check/{n} [json]
    kkk -> disp=null [500 bool=null] {"error":"Only HTML requests are supported here"}
--- https://api.hytale.tools/check/{n} [json]
    kkk -> disp=true [404 404-sem-json] Not Found
--- https://hytale.tools/api/check/{n} [json]
    kkk -> disp=null [500 bool=null] {"error":"Only HTML requests are supported here"}
--- https://hytl.tools/api/player/{n} [json]
    kkk -> disp=null [500 bool=null] {"error":"Only HTML requests are supported here"}
--- https://playerdb.co/api/player/hytale/{n} [json]
    kkk -> disp=true [400 hytale.not_found] {"message":"No Hytale player could be found with the given identifier.","code":"hytale.not_found","d
```
NENHUMA fonte qualificada.
