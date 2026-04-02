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

    async function signIn(email: string, password: string) {
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });
        if (error) throw error;

        setAccount({
            id: data.user!.id,
            email: data.user!.email!,
            jwt: data.session?.access_token!,
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
            jwt: data.session?.access_token!,
        });
    }

    async function signOut() {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;

        setAccount(null);
    }

    const [accountInfo, setAccountInfo] = useState<AccountInfo>({
        account: null,
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
