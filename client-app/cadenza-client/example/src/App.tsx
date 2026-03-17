import { Text, View, StyleSheet, Button } from 'react-native';
import { useState } from 'react';
import { greet, CoinToss } from 'react-native-cadenza-client';



export default function App() {
  // CoinToss struct is defined in cadenza-client/crates/hello_world/src/lib.rs
  const coin = new CoinToss();
  // greet function is also defined there
  const message = greet("John Doe");

  const [buttonText, setButtonText] = useState("Toss Coin");

  const handleClick = () => {
    if (buttonText === "Toss Coin") {
      const isHeads = coin.toss();
      setButtonText(isHeads ? 'Heads' : 'Tails');
      setTimeout(() => {
        setButtonText("Toss Coin");
      }, 1000);
    }
  }

  return (
    <View style={styles.container}>
      <Text>Result from Rust: "{message}"</Text>
      <Button title={buttonText} onPress={handleClick} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
