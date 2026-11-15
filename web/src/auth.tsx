import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import { Marca } from "./components/Logo";

type AuthState = { session: Session; isAdmin: boolean; telas: Set<string>; pode: (chave: string) => boolean };
const AuthCtx = createContext<AuthState | null>(null);
export const useAuth = () => useContext(AuthCtx)!;

type Acesso = { status: "aprovado" | "pendente" | "bloqueado"; admin: boolean; telas: string[] };

// volta para a mesma página (sem o #rota), em qualquer endereço onde o site estiver
const redirectTo = () => `${window.location.origin}${window.location.pathname}`;

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [access, setAccess] = useState<Acesso | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setAccess(null); return; }
    (async () => {
      // primeiro login registra o pedido de acesso; quem já está na lista recebe o status atual
      const { data: status } = await supabase.rpc("pedir_acesso");
      const email = (session.user.email ?? "").toLowerCase();
      const { data: eu } = await supabase.from("allowed_users").select("papel,status,telas").eq("email", email).maybeSingle();
      setAccess({
        status: (eu?.status ?? status ?? "pendente") as Acesso["status"],
        admin: eu?.papel === "admin" && eu?.status === "aprovado",
        telas: eu?.telas ?? [],
      });
    })();
  }, [session?.user.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (session === undefined || (session && !access)) {
    return <Center><p className="text-sm text-muted">Carregando…</p></Center>;
  }
  if (!session) return <Login />;
  if (access!.status !== "aprovado") {
    const bloqueado = access!.status === "bloqueado";
    return (
      <Center>
        <Marca />
        <h1 className="mt-6 text-xl font-extrabold">{bloqueado ? "Acesso bloqueado" : "Aguardando aprovação"}</h1>
        <p className="mt-2 max-w-sm text-center text-sm text-muted">
          {bloqueado ? (
            <>O acesso de <strong className="text-ink">{session.user.email}</strong> foi bloqueado por um administrador.</>
          ) : (
            <>Seu pedido de acesso com <strong className="text-ink">{session.user.email}</strong> foi enviado. Assim que um administrador aprovar e escolher as telas, é só recarregar esta página.</>
          )}
        </p>
        <div className="mt-5 flex gap-2">
          {!bloqueado && (
            <button type="button" onClick={() => window.location.reload()} className="min-h-11 rounded-lg bg-ink px-4 font-semibold text-white">
              Já fui aprovado
            </button>
          )}
          <button type="button" onClick={() => supabase.auth.signOut()} className="min-h-11 rounded-lg border border-line bg-white px-4 font-semibold">
            Sair
          </button>
        </div>
      </Center>
    );
  }
  const telas = new Set(access!.telas);
  const admin = access!.admin;
  return (
    <AuthCtx.Provider value={{ session, isAdmin: admin, telas, pode: (chave: string) => admin || telas.has(chave) }}>
      {children}
    </AuthCtx.Provider>
  );
}

function Center({ children }: { children: ReactNode }) {
  return <div className="flex min-h-screen flex-col items-center justify-center bg-ground px-4 font-sans text-ink">{children}</div>;
}

function Login() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [msg, setMsg] = useState("");

  const google = async () => {
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: redirectTo(), queryParams: { prompt: "select_account" } } });
    if (error) { setStatus("error"); setMsg("Login com Google ainda não está ativado. Use o link por e-mail."); }
  };

  const magic = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("sending");
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim().toLowerCase(), options: { emailRedirectTo: redirectTo(), shouldCreateUser: true } });
    if (error) { setStatus("error"); setMsg(error.message); } else setStatus("sent");
  };

  return (
    <Center>
      <div className="w-full max-w-sm rounded-2xl border border-line bg-white p-7">
        <Marca />
        <h1 className="mt-6 text-xl font-extrabold">Entrar</h1>
        <p className="mt-1 text-sm text-muted">Acesso só para o time da Aphago e da Abrasso. No primeiro login, o acesso fica pendente até um administrador aprovar.</p>

        <button type="button" onClick={google} className="mt-5 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-line font-semibold hover:bg-ground">
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
          Entrar com Google
        </button>

        <div className="my-5 flex items-center gap-3 text-xs text-muted"><span className="h-px flex-1 bg-line" />ou<span className="h-px flex-1 bg-line" /></div>

        {status === "sent" ? (
          <p className="rounded-lg bg-ground p-4 text-sm">Enviamos um link de acesso para <strong>{email}</strong>. Abra o e-mail neste mesmo navegador.</p>
        ) : (
          <form onSubmit={magic} className="flex flex-col gap-2">
            <label htmlFor="email" className="text-[13px] font-semibold">E-mail</label>
            <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@exemplo.com" className="min-h-11 rounded-lg border border-line px-3" />
            <button type="submit" disabled={status === "sending"} className="mt-1 min-h-11 rounded-lg bg-ink font-semibold text-white disabled:opacity-60">
              {status === "sending" ? "Enviando…" : "Receber link por e-mail"}
            </button>
          </form>
        )}
        {status === "error" && <p role="alert" className="mt-3 text-sm text-ruim">{msg}</p>}
      </div>
    </Center>
  );
}
