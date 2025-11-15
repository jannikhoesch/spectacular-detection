from flask import Flask, request, jsonify
from flask_cors import CORS
import joblib
import numpy as np
import os

app = Flask(__name__)
CORS(app)

model = joblib.load('migraine_regressor.pkl')

def prepare_input(data):
    # Extract input features from JSON and apply defaults as needed
    age = data.get('age')
    gender = data.get('gender', 'Male')
    gender_numeric = 1 if gender.lower() == 'female' else 0

    sleep_hours = data.get('sleep_hours')
    screen_time_hours = data.get('screen_time_hours')
    steps = data.get('steps')
    stress_level = data.get('stress_level')
    barometric_pressure = data.get('barometric_pressure')
    hour_of_day = data.get('hour_of_day')
    menstrual_cycle_day = data.get('menstrual_cycle_day', 15)

    heart_rate_variability = data.get('heart_rate_variability', 60)
    resting_heart_rate = data.get('resting_heart_rate', 70)
    sleep_quality_score = data.get('sleep_quality_score', 6)
    light_exposure = data.get('light_exposure', 50)
    posture_quality = data.get('posture_quality', 60)

    input_array = np.array([[
        age, sleep_hours, screen_time_hours, steps, stress_level,
        barometric_pressure, hour_of_day, heart_rate_variability,
        resting_heart_rate, sleep_quality_score, menstrual_cycle_day,
        light_exposure, posture_quality, gender_numeric
    ]])
    return input_array

@app.route('/predict', methods=['POST'])
def predict():
    try:
        data = request.json
        input_array = prepare_input(data)
        risk_percentage = model.predict(input_array)[0]
        risk_percentage = np.clip(risk_percentage, 0, 100)

        # Determine risk level
        if risk_percentage < 30:
            risk_level = "Low"
        elif risk_percentage < 60:
            risk_level = "Medium"
        else:
            risk_level = "High"

        # Generate contributing factors
        factors = []
        if data.get('gender', 'Male').lower() == 'female':
            factors.append("Female (higher baseline risk)")
            if data.get('menstrual_cycle_day', 15) <= 3 or data.get('menstrual_cycle_day', 15) >= 25:
                factors.append("Hormonal phase (menstrual/pre-menstrual)")
        if 18 <= data.get('age', 0) <= 44:
            factors.append("Peak migraine age group")
        if data.get('sleep_hours', 0) < 6:
            factors.append("Poor sleep quality")
        if data.get('screen_time_hours', 0) > 7:
            factors.append("Excessive screen time")
        if data.get('steps', 0) < 3000:
            factors.append("Low physical activity")
        if data.get('stress_level', 0) > 7:
            factors.append("High stress levels")
        if data.get('barometric_pressure', 1013) < 1000:
            factors.append("Dropping barometric pressure")
        if 6 <= data.get('hour_of_day', 0) <= 10:
            factors.append("Morning hours (common attack time)")

        # Generate recommendations
        recommendations = []
        if data.get('sleep_hours', 7) < 7:
            recommendations.append("Get 7-8 hours of sleep tonight")
        if data.get('screen_time_hours', 0) > 6:
            recommendations.append("Reduce screen time and take breaks")
        if data.get('stress_level', 0) > 6:
            recommendations.append("Practice relaxation techniques")
        if risk_percentage > 60:
            recommendations.append("Consider preventive medication")
        if data.get('gender', 'Male').lower() == 'female' and (data.get('menstrual_cycle_day', 15) <= 3 or data.get('menstrual_cycle_day', 15) >= 25):
            recommendations.append("Track hormonal triggers and consider hormonal management")

        confidence = "High" if 'heart_rate_variability' in data else "Medium"

        return jsonify({
            "risk_percentage": round(risk_percentage, 1),
            "risk_level": risk_level,
            "contributing_factors": factors,
            "recommendations": recommendations,
            "confidence": confidence
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 400

@app.route('/')
def index():
    return "Migraine Prediction API Running"

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
