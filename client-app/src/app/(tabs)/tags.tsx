import { Text, View, StyleSheet, TextInput, Button } from "react-native";

export default function TagsScreen() {

    return (
        <View style={styles.container}>
            <Text style={styles.text}>Tags Screen</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: "#25292e",
    },
    text: {
        color: "#fff",
    },
    rowContainer: {
        flexDirection: "row",
    },
    textInput: {
        outlineColor: "white",
        outlineWidth: 2,
        padding: 4,
    },
});
