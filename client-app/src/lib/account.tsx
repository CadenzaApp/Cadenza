import { supabase } from "./supabase";
import { useState, createContext, useContext } from "react";

type Account = {
    id: string;
    email: string;
    jwt: string;
};

/** if `account == null`, then user isn't logged in */
type AccountInfo = {
    account: Account | null;
    tryRestoreSession: () => Promise<boolean>;
    signIn: (email: string, password: string) => Promise<void>;
    signUp: (email: string, password: string) => Promise<void>;
    signOut: () => Promise<void>;
};

const AccountContext = createContext<AccountInfo | null>(null);

export function useAccount() {
    return useContext(AccountContext)!;
}

type Props = Readonly<{
    children: React.ReactNode;
}>;
export default function AccountProvider({ children }: Props) {
    function setAccount(acc: Account | null) {
        setAccountInfo((prev) => ({
            ...prev,
            account: acc,
        }));
    }

    /**
     * returns `true` if there was an existing session which was restored.
     *
     * this fn is called upon splashscreen render instead of
     * right here in AccountProvider to avoid having to
     * add a "loading" state in the account context.
     *  -  Pages that arent splashscreen and /auth shouldnt have
     *     to worry about if an account is being loaded or not.
     */
    async function tryRestoreSession() {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;

        if (data.session != null) {
            console.log("session restored:", data.session.user.email);
            setAccount({
                id: data.session.user.id,
                email: data.session.user.email!,
                jwt: data.session.access_token,
            });
            return true;
        }
        console.log("no session");
        return false;

    }

    async function signIn(email: string, password: string) {
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });
        if (error) throw error;

        setAccount({
            id: data.user!.id,
            email: data.user!.email!,
            jwt: data.session!.access_token,
        });
    }

    async function signUp(email: string, password: string) {
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
        });
        if (error) throw error;

        setAccount({
            id: data.user!.id,
            email: data.user!.email!,
            jwt: data.session!.access_token,
        });
    }

    async function signOut() {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;

        setAccount(null);
    }

    const [accountInfo, setAccountInfo] = useState<AccountInfo>({
        account: null,
        tryRestoreSession,
        signIn,
        signUp,
        signOut,
    });

    return (
        <AccountContext.Provider value={accountInfo}>
            {children}
        </AccountContext.Provider>
    );
}
